"""Event-driven single-symbol backtester with fees, slippage, stops and a kill switch.

Timing: the signal from bar t's close is traded at bar t+1's OPEN. Stops and
targets are checked against each bar's high/low after entry.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .risk import RiskManager
from .strategies import Strategy


@dataclass
class Trade:
    entry_time: pd.Timestamp
    entry_price: float
    qty: float
    exit_time: pd.Timestamp | None = None
    exit_price: float | None = None
    reason: str = ""
    fees: float = 0.0

    @property
    def pnl(self) -> float:
        return (self.exit_price - self.entry_price) * self.qty - self.fees if self.exit_price is not None else 0.0

    @property
    def return_pct(self) -> float:
        return self.pnl / (self.entry_price * self.qty) if self.qty else 0.0


@dataclass
class BacktestResult:
    equity: pd.Series
    trades: list[Trade]
    signals: pd.Series
    metrics: dict = field(default_factory=dict)

    def trades_frame(self) -> pd.DataFrame:
        return pd.DataFrame([{**t.__dict__, "pnl": t.pnl, "return_pct": t.return_pct} for t in self.trades])


def periods_per_year(timeframe: str, crypto: bool) -> float:
    if timeframe == "1Hour":
        return 365 * 24 if crypto else 252 * 6.5
    return 365 if crypto else 252


def max_drawdown(equity: pd.Series) -> float:
    peak = equity.cummax()
    return float((equity / peak - 1).min())


def compute_metrics(equity: pd.Series, trades: list[Trade], close: pd.Series, ppy: float,
                    in_market: np.ndarray) -> dict:
    rets = equity.pct_change().dropna()
    years = len(equity) / ppy
    total = equity.iloc[-1] / equity.iloc[0] - 1
    std = rets.std()
    downside = rets[rets < 0].std()
    wins = [t for t in trades if t.pnl > 0]
    losses = [t for t in trades if t.pnl <= 0]
    gross_loss = -sum(t.pnl for t in losses)
    bh_equity = close / close.iloc[0]
    return {
        "total_return": total,
        "cagr": (1 + total) ** (1 / years) - 1 if years > 0 and total > -1 else float("nan"),
        "sharpe": rets.mean() / std * np.sqrt(ppy) if std > 0 else 0.0,
        "sortino": rets.mean() / downside * np.sqrt(ppy) if downside and downside > 0 else 0.0,
        "max_drawdown": max_drawdown(equity),
        "trades": len(trades),
        "win_rate": len(wins) / len(trades) if trades else 0.0,
        "profit_factor": sum(t.pnl for t in wins) / gross_loss if gross_loss > 0 else float("inf") if wins else 0.0,
        "avg_trade_return": float(np.mean([t.return_pct for t in trades])) if trades else 0.0,
        "exposure": float(in_market.mean()),
        "buy_hold_return": bh_equity.iloc[-1] - 1,
        "buy_hold_max_drawdown": max_drawdown(bh_equity),
        "final_equity": float(equity.iloc[-1]),
    }


def run_backtest(df: pd.DataFrame, strategy: Strategy, risk: RiskManager, initial_cash: float = 10_000,
                 fee_bps: float = 0.0, slippage_bps: float = 5.0, ppy: float = 252,
                 signals: pd.Series | None = None) -> BacktestResult:
    if len(df) < 3:
        raise ValueError("need at least 3 bars")
    sig = (signals if signals is not None else strategy.generate(df)).reindex(df.index).fillna(0.0).to_numpy()
    o, h, l, c = (df[k].to_numpy() for k in ("open", "high", "low", "close"))
    days = df.index.normalize()
    fee, slip = fee_bps / 1e4, slippage_bps / 1e4

    cash, qty = float(initial_cash), 0.0
    trade: Trade | None = None
    trades: list[Trade] = []
    blocked = False  # after a stop/kill, wait for the signal to reset to flat before re-entering
    equity = np.empty(len(df))
    in_market = np.zeros(len(df), dtype=bool)
    equity[0] = cash
    day_start_equity, current_day = cash, days[0]

    def close_trade(t_idx: int, price: float, reason: str):
        nonlocal cash, qty, trade
        fill = price * (1 - slip)
        cost = fill * qty * fee
        cash += fill * qty - cost
        trade.exit_time, trade.exit_price, trade.reason = df.index[t_idx], fill, reason
        trade.fees += cost
        trades.append(trade)
        qty, trade = 0.0, None

    for t in range(1, len(df)):
        if days[t] != current_day:
            current_day, day_start_equity = days[t], equity[t - 1]
        want_long = sig[t - 1] > 0
        if not want_long:
            blocked = False

        # 1) act on yesterday's signal at today's open
        if qty > 0 and not want_long:
            close_trade(t, o[t], "signal")
        elif qty == 0 and want_long and not blocked:
            fill = o[t] * (1 + slip)
            size = risk.position_qty(cash, fill, sig[t - 1])  # flat, so cash == equity
            size = min(size, cash / (fill * (1 + fee)))  # leave room for the fee
            if size > 0:
                cost = fill * size * fee
                cash -= fill * size + cost
                qty = size
                trade = Trade(df.index[t], fill, size, fees=cost)

        # 2) intrabar stop / take-profit
        if qty > 0:
            hit = risk.check_exit(trade.entry_price, o[t], h[t], l[t])
            if hit:
                close_trade(t, hit[0], hit[1])
                blocked = hit[1] != "take_profit"

        in_market[t] = qty > 0
        equity[t] = cash + qty * c[t]

        # 3) daily kill switch, flatten at the close
        if qty > 0 and risk.daily_loss_breached(day_start_equity, equity[t]):
            close_trade(t, c[t], "daily_loss_kill")
            blocked = True
            equity[t] = cash

    if trade is not None:  # mark the open position closed at the last price for stats
        close_trade(len(df) - 1, c[-1], "end_of_data")
        equity[-1] = cash

    eq = pd.Series(equity, index=df.index, name="equity")
    res = BacktestResult(eq, trades, pd.Series(sig, index=df.index))
    res.metrics = compute_metrics(eq, trades, df["close"], ppy, in_market)
    return res


def format_metrics(m: dict) -> str:
    pct = {"total_return", "cagr", "max_drawdown", "win_rate", "avg_trade_return", "exposure",
           "buy_hold_return", "buy_hold_max_drawdown"}
    lines = []
    for k, v in m.items():
        if k in pct:
            lines.append(f"  {k:<22} {v:>10.2%}")
        elif k == "trades":
            lines.append(f"  {k:<22} {v:>10d}")
        else:
            lines.append(f"  {k:<22} {v:>10.2f}")
    return "\n".join(lines)
