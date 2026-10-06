from datetime import timedelta

import pandas as pd

from tradebot.brokers import LocalBroker
from tradebot.data import synthetic
from tradebot.live import Bot, completed_bars
from tradebot.risk import RiskConfig, RiskManager
from tradebot.strategies import Strategy


class Fixed(Strategy):
    def __init__(self, v):
        self.v = v

    def generate(self, df):
        return pd.Series(self.v, index=df.index, dtype=float)


def make_bot(tmp_path, strat, df, **risk):
    cfg = dict(max_position_pct=0.2, risk_per_trade=0.05, stop_loss_pct=0.05, take_profit_pct=0.10,
               max_daily_loss_pct=0.03, min_order_usd=1)
    cfg.update(risk)
    broker = LocalBroker(str(tmp_path / "b.json"), 10_000, slippage_bps=0)
    holder = {"df": df}
    bot = Bot(["SPY"], strat, RiskManager(RiskConfig(**cfg)), broker, lambda s: holder["df"],
              journal_path=str(tmp_path / "j.csv"), state_path=str(tmp_path / "s.json"),
              clock=lambda: (holder["df"].index[-1] + timedelta(days=1)).to_pydatetime())
    return bot, holder


def test_completed_bars_drops_forming_bar():
    df = synthetic(10)
    assert len(completed_bars(df, "1Day", df.index[-1].to_pydatetime() + timedelta(hours=3))) == 9
    assert len(completed_bars(df, "1Day", df.index[-1].to_pydatetime() + timedelta(days=1))) == 10


def test_buys_then_sells_on_signal(tmp_path):
    df = synthetic(50)
    bot, h = make_bot(tmp_path, Fixed(1.0), df)
    assert bot.tick()["actions"] == [("SPY", "buy", "signal")]
    assert bot.broker.get_position("SPY").qty > 0
    bot.strategy = Fixed(0.0)
    assert bot.tick()["actions"] == [("SPY", "sell", "signal")]
    assert bot.broker.get_position("SPY") is None
    assert (tmp_path / "j.csv").read_text().count("\n") == 3  # header + 2 orders


def test_stop_loss_then_blocked(tmp_path):
    df = synthetic(50)
    bot, h = make_bot(tmp_path, Fixed(1.0), df)
    bot.tick()
    crash = df.copy()
    crash.iloc[-1, crash.columns.get_loc("close")] *= 0.90
    h["df"] = crash
    assert bot.tick()["actions"] == [("SPY", "sell", "stop_loss")]
    assert bot.tick()["actions"] == []  # signal still 1 but blocked


def test_dry_run_sends_no_orders(tmp_path):
    bot, _ = make_bot(tmp_path, Fixed(1.0), synthetic(50))
    bot.dry_run = True
    bot.tick()
    assert bot.broker.get_position("SPY") is None


def test_kill_switch_halts(tmp_path):
    df = synthetic(50)
    bot, h = make_bot(tmp_path, Fixed(1.0), df, max_position_pct=1.0, stop_loss_pct=0.5, risk_per_trade=0.05)
    bot.tick()  # buys ~10% of equity (risk cap 5% / 50% stop)
    bot.broker.cash -= 500  # simulate a 5% account loss elsewhere today
    s = bot.tick()
    assert ("SPY", "sell", "daily_loss_kill") in s["actions"]
    assert bot.state["halted"]
    assert bot.tick()["actions"] == []
