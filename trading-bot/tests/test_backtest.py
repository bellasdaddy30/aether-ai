import numpy as np
import pandas as pd
import pytest

from tradebot.backtest import run_backtest
from tradebot.data import synthetic
from tradebot.risk import RiskConfig, RiskManager
from tradebot.strategies import Strategy


class Fixed(Strategy):
    def __init__(self, values):
        self.values = values

    def generate(self, df):
        return pd.Series(self.values, index=df.index, dtype=float)


def bars(closes, opens=None, highs=None, lows=None):
    closes = np.asarray(closes, float)
    opens = closes if opens is None else np.asarray(opens, float)
    idx = pd.date_range("2024-01-01", periods=len(closes), freq="D", tz="UTC")
    return pd.DataFrame({"open": opens, "high": highs if highs is not None else np.maximum(opens, closes),
                         "low": lows if lows is not None else np.minimum(opens, closes),
                         "close": closes, "volume": 1.0}, index=idx)


RISK = RiskManager(RiskConfig(max_position_pct=1.0, risk_per_trade=0.05, stop_loss_pct=0.0,
                              take_profit_pct=0.0, max_daily_loss_pct=0.99, min_order_usd=0))


def test_trades_next_open_not_same_close():
    # signal fires on bar 1's close; entry must happen at bar 2's OPEN (105), not bar 1's close (100)
    df = bars([100, 100, 110, 120], opens=[100, 100, 105, 120])
    res = run_backtest(df, Fixed([0, 1, 1, 1]), RISK, 1000, slippage_bps=0)
    assert res.trades[0].entry_price == 105
    assert res.trades[0].entry_time == df.index[2]


def test_flat_signal_means_no_trades_and_flat_equity():
    df = synthetic(200)
    res = run_backtest(df, Fixed(np.zeros(200)), RISK, 1000)
    assert res.trades == [] and (res.equity == 1000).all()


def test_fees_and_slippage_cost_money():
    df = bars([100] * 10)
    res = run_backtest(df, Fixed([1, 0] * 5), RISK, 1000, fee_bps=10, slippage_bps=10)
    assert res.equity.iloc[-1] < 1000
    assert all(t.pnl < 0 for t in res.trades)


def test_stop_loss_exits_and_blocks_reentry_until_signal_resets():
    risk = RiskManager(RiskConfig(max_position_pct=1.0, risk_per_trade=0.05, stop_loss_pct=0.05,
                                  take_profit_pct=0, max_daily_loss_pct=0.99, min_order_usd=0))
    closes = [100, 100, 100, 90, 90, 90, 90, 90]
    df = bars(closes, opens=[100, 100, 100, 99, 90, 90, 90, 90], lows=[100, 100, 100, 89, 90, 90, 90, 90])
    res = run_backtest(df, Fixed([1, 1, 1, 1, 1, 0, 1, 1]), risk, 1000, slippage_bps=0)
    assert res.trades[0].reason == "stop_loss"
    assert res.trades[0].exit_price == pytest.approx(95)
    # no re-entry on bars 4-5 while signal stays 1; re-entry only after it went to 0 on bar 5 -> enter bar 7
    assert res.trades[1].entry_time == df.index[7]


def test_buy_and_hold_matches_price_change():
    df = bars([100, 100, 150, 200], opens=[100, 100, 150, 200])
    res = run_backtest(df, Fixed([1, 1, 1, 1]), RISK, 1000, slippage_bps=0)
    assert res.metrics["total_return"] == pytest.approx(1.0)
