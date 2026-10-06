import pytest

from tradebot.risk import RiskConfig, RiskManager


def rm(**kw):
    return RiskManager(RiskConfig.from_dict(kw))


def test_position_capped_by_max_pct():
    r = rm(max_position_pct=0.10, risk_per_trade=0.05, stop_loss_pct=0.05)
    assert r.position_notional(10_000) == pytest.approx(1_000)


def test_position_capped_by_risk_per_trade():
    # risking 1% with a 10% stop => at most 10% of equity in the trade
    r = rm(max_position_pct=0.5, risk_per_trade=0.01, stop_loss_pct=0.10)
    assert r.position_notional(10_000) == pytest.approx(1_000)


def test_dust_orders_skipped():
    assert rm(min_order_usd=50).position_notional(100) == 0


def test_stop_gap_fills_at_open_not_stop():
    r = rm(stop_loss_pct=0.05, take_profit_pct=0.10)
    assert r.check_exit(100, open_=90, high=92, low=89) == (90, "stop_gap")


def test_stop_beats_target_when_both_touched():
    r = rm(stop_loss_pct=0.05, take_profit_pct=0.10)
    assert r.check_exit(100, open_=100, high=111, low=94) == (95, "stop_loss")


def test_take_profit():
    r = rm(stop_loss_pct=0.05, take_profit_pct=0.10)
    assert r.check_exit(100, open_=101, high=111, low=99) == (pytest.approx(110), "take_profit")


def test_daily_loss():
    r = rm(max_daily_loss_pct=0.03)
    assert r.daily_loss_breached(10_000, 9_700)
    assert not r.daily_loss_breached(10_000, 9_701)


@pytest.mark.parametrize("bad", [{"max_position_pct": 1.5}, {"risk_per_trade": 0.2}, {"max_daily_loss_pct": 0}])
def test_rejects_dangerous_config(bad):
    with pytest.raises(ValueError):
        RiskConfig.from_dict(bad)
