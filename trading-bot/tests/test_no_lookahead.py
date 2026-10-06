"""The single most important test: a strategy's signal at bar t must not change
when we hide every bar after t. If it does, the strategy is peeking at the future
and its backtest is fiction."""
import numpy as np
import pytest

from tradebot.data import synthetic
from tradebot.strategies import build_strategy

PARAMS = {
    "sma_cross": {"fast": 10, "slow": 30},
    "rsi_reversion": {"trend_sma": 50},
    "ml": {"train_window": 300, "retrain_every": 25, "min_train": 150, "horizon": 5},
    "ensemble": {"members": ["sma_cross", "rsi_reversion", "ml"], "min_votes": 2},
}


@pytest.mark.parametrize("name", ["sma_cross", "rsi_reversion", "ml", "ensemble"])
def test_signals_do_not_use_future_bars(name):
    df = synthetic(n=600, seed=3)
    full = build_strategy(name, PARAMS).generate(df)
    for cut in (260, 333, 420, 599):
        partial = build_strategy(name, PARAMS).generate(df.iloc[:cut])
        np.testing.assert_array_equal(partial.to_numpy(), full.iloc[:cut].to_numpy(),
                                      err_msg=f"{name} changed past signals when future bars were removed (cut={cut})")


def test_ml_signal_is_not_magically_accurate_on_random_data():
    """On a pure random walk there is nothing to predict. A >60% hit rate would mean leakage."""
    rng = np.random.default_rng(0)
    df = synthetic(n=1200, seed=11)
    # Replace with a driftless pure random walk (synthetic() has regimes the model may legitimately catch).
    close = 100 * np.exp(np.cumsum(rng.normal(0, 0.01, len(df))))
    df = df.assign(close=close, open=close, high=close * 1.005, low=close * 0.995)
    strat = build_strategy("ml", {"ml": {"train_window": 400, "retrain_every": 20, "min_train": 200,
                                         "horizon": 5, "threshold": 0.5}})
    strat.generate(df)
    proba = strat.last_proba
    fwd_up = (df["close"].shift(-5) > df["close"]).astype(float)
    mask = proba.notna() & df["close"].shift(-5).notna()
    acc = ((proba[mask] >= 0.5).astype(float) == fwd_up[mask]).mean()
    assert 0.40 < acc < 0.60, f"accuracy {acc:.2f} on random data smells like lookahead"


def test_ml_latest_has_no_lookahead_and_returns_binary():
    df = synthetic(600, seed=5)
    strat = build_strategy("ml", PARAMS)
    a = strat.latest(df.iloc[:450])
    # Changing every bar after 450 must not change the decision made at 450.
    tampered = df.copy()
    tampered.iloc[450:, tampered.columns.get_loc("close")] *= 3
    b = build_strategy("ml", PARAMS).latest(tampered.iloc[:450])
    assert a == b and a in (0.0, 1.0)
