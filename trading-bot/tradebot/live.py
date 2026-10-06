"""The live/paper trading loop.

Each tick:
  1. Check the daily-loss kill switch (flatten everything and halt for the day).
  2. For each symbol: fetch bars, drop the still-forming bar, compute the signal
     from COMPLETED bars only, then exit on stop/target/signal or enter if allowed.
  3. Journal every order to CSV and persist state to JSON so restarts are safe.

Stops are checked on each tick in software, not placed as broker-side orders,
because Alpaca crypto doesn't support bracket orders. With poll_seconds=300 a
stop can be exceeded by whatever price moves in 5 minutes - and gaps overnight
or over weekends can blow straight through it.
"""
from __future__ import annotations

import csv
import json
import logging
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

import pandas as pd

from .brokers import Broker
from .risk import RiskManager
from .strategies import Strategy

log = logging.getLogger("tradebot")


def completed_bars(df: pd.DataFrame, timeframe: str, now: datetime) -> pd.DataFrame:
    """Drop the last bar if it hasn't closed yet. Trading on a half-built bar is a classic live-vs-backtest mismatch."""
    if df.empty:
        return df
    bar = timedelta(days=1) if timeframe == "1Day" else timedelta(hours=1)
    return df.iloc[:-1] if df.index[-1] + bar > now else df


class Bot:
    def __init__(self, symbols: list[str], strategy: Strategy, risk: RiskManager, broker: Broker,
                 data_fn: Callable[[str], pd.DataFrame], timeframe: str = "1Day",
                 journal_path: str = "logs/trades.csv", state_path: str = "state/bot_state.json",
                 dry_run: bool = False, clock: Callable[[], datetime] | None = None, drop_partial: bool = True):
        self.symbols, self.strategy, self.risk, self.broker = symbols, strategy, risk, broker
        self.data_fn, self.timeframe, self.dry_run, self.drop_partial = data_fn, timeframe, dry_run, drop_partial
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.journal_path, self.state_path = Path(journal_path), Path(state_path)
        self.state = self._load_state()

    # ---- persistence -------------------------------------------------------
    def _load_state(self) -> dict:
        if self.state_path.exists():
            return json.loads(self.state_path.read_text())
        return {"day": None, "day_start_equity": None, "halted": False, "blocked": {}}

    def _save_state(self):
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        self.state_path.write_text(json.dumps(self.state, indent=2))

    def _journal(self, symbol, side, qty, price, reason, equity, order_id=""):
        self.journal_path.parent.mkdir(parents=True, exist_ok=True)
        new = not self.journal_path.exists()
        with self.journal_path.open("a", newline="") as f:
            w = csv.writer(f)
            if new:
                w.writerow(["time", "mode", "symbol", "side", "qty", "price", "reason", "equity", "order_id"])
            mode = "dry_run" if self.dry_run else ("paper" if self.broker.paper else "LIVE")
            w.writerow([self.clock().isoformat(), mode, symbol, side, f"{qty:.6f}", f"{price:.4f}", reason,
                        f"{equity:.2f}", order_id])
        log.info("%s %s %.6f @ %.4f (%s)", side.upper(), symbol, qty, price, reason)

    def _price(self, symbol) -> float:
        return float(self.data_fn(symbol)["close"].iloc[-1])

    # ---- order helpers -----------------------------------------------------
    def _close(self, symbol, qty, price, reason, equity):
        oid = "" if self.dry_run else self.broker.close(symbol, price)
        self._journal(symbol, "sell", qty, price, reason, equity, oid)

    def _buy(self, symbol, qty, price, reason, equity):
        oid = "" if self.dry_run else self.broker.buy(symbol, qty, price)
        self._journal(symbol, "buy", qty, price, reason, equity, oid)

    # ---- main logic --------------------------------------------------------
    def tick(self) -> dict:
        now = self.clock()
        if hasattr(self.broker, "mark"):  # local sim broker: refresh prices before valuing the account
            for s in self.symbols:
                if self.broker.get_position(s):
                    self.broker.mark(s, self._price(s))
        equity = self.broker.get_equity()
        today = now.date().isoformat()
        if self.state["day"] != today:
            self.state.update(day=today, day_start_equity=equity, halted=False)
            log.info("new trading day %s, start equity %.2f", today, equity)

        summary = {"equity": equity, "actions": []}
        if self.state["halted"]:
            log.warning("halted for the day by kill switch; skipping")
            self._save_state()
            return summary

        if self.risk.daily_loss_breached(self.state["day_start_equity"], equity):
            log.error("DAILY LOSS LIMIT HIT (%.2f -> %.2f). Flattening and halting.",
                      self.state["day_start_equity"], equity)
            for s in self.symbols:
                pos = self.broker.get_position(s)
                if pos and self.broker.is_market_open(s):
                    self._close(s, pos.qty, self._price(s), "daily_loss_kill", equity)
                    self.state["blocked"][s] = True
                    summary["actions"].append((s, "sell", "daily_loss_kill"))
            self.state["halted"] = True
            self._save_state()
            return summary

        open_count = sum(1 for s in self.symbols if self.broker.get_position(s))
        for symbol in self.symbols:
            try:
                action = self._handle_symbol(symbol, equity, open_count, now)
            except Exception:  # one bad symbol shouldn't take down the loop
                log.exception("error handling %s", symbol)
                continue
            if action:
                summary["actions"].append((symbol, *action))
                open_count += 1 if action[0] == "buy" else -1
        self._save_state()
        return summary

    def _handle_symbol(self, symbol, equity, open_count, now):
        if not self.broker.is_market_open(symbol):
            log.debug("%s market closed", symbol)
            return None
        df = self.data_fn(symbol)
        price = float(df["close"].iloc[-1])  # latest price, may be from the still-forming bar
        if hasattr(self.broker, "mark"):
            self.broker.mark(symbol, price)
        bars = completed_bars(df, self.timeframe, now) if self.drop_partial else df
        if len(bars) <= self.strategy.warmup:
            log.warning("%s only %d bars, strategy needs > %d", symbol, len(bars), self.strategy.warmup)
            return None
        signal = self.strategy.latest(bars)
        blocked = self.state["blocked"].get(symbol, False)
        if signal <= 0 and blocked:
            self.state["blocked"][symbol] = blocked = False

        pos = self.broker.get_position(symbol)
        if pos:
            stop, take = self.risk.stop_price(pos.avg_entry), self.risk.take_price(pos.avg_entry)
            if stop is not None and price <= stop:
                self._close(symbol, pos.qty, price, "stop_loss", equity)
                self.state["blocked"][symbol] = True
                return ("sell", "stop_loss")
            if take is not None and price >= take:
                self._close(symbol, pos.qty, price, "take_profit", equity)
                return ("sell", "take_profit")
            if signal <= 0:
                self._close(symbol, pos.qty, price, "signal", equity)
                return ("sell", "signal")
            return None

        if signal > 0 and not blocked and self.risk.can_open(open_count):
            qty = self.risk.position_qty(equity, price, signal)
            if qty > 0:
                self._buy(symbol, qty, price, "signal", equity)
                return ("buy", "signal")
        return None

    def run(self, poll_seconds: int = 300, max_ticks: int | None = None):
        mode = "DRY RUN" if self.dry_run else ("PAPER" if self.broker.paper else "*** LIVE MONEY ***")
        log.info("starting bot [%s] symbols=%s strategy=%s poll=%ss", mode, self.symbols, self.strategy.name,
                 poll_seconds)
        ticks = 0
        while max_ticks is None or ticks < max_ticks:
            try:
                s = self.tick()
                log.info("tick done: equity=%.2f actions=%s", s["equity"], s["actions"] or "none")
            except KeyboardInterrupt:
                raise
            except Exception:
                log.exception("tick failed; will retry next poll")
            ticks += 1
            if max_ticks is None or ticks < max_ticks:
                time.sleep(poll_seconds)
