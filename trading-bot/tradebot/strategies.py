"""Strategies turn price history into a target exposure per bar.

Contract: strategy.generate(df) returns a Series aligned to df.index with values
in [0, 1] (0 = flat, 1 = fully long, sized later by the risk manager).
The value at bar t may only use data up to and including bar t's close.
The backtester executes it at bar t+1's open. tests/test_no_lookahead.py enforces this.

Long-only on purpose: shorting adds borrow costs, unlimited loss, and Alpaca
doesn't allow shorting crypto anyway.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import indicators as ta


class Strategy:
    name = "base"
    warmup = 0  # bars needed before signals mean anything

    def generate(self, df: pd.DataFrame) -> pd.Series:
        raise NotImplementedError

    def latest(self, df: pd.DataFrame) -> float:
        """Signal for the newest bar only. Live trading calls this; override when there's a faster path."""
        return float(self.generate(df).iloc[-1])


class SmaCross(Strategy):
    """Classic trend following: long while the fast average is above the slow one."""
    name = "sma_cross"

    def __init__(self, fast: int = 20, slow: int = 50):
        if fast >= slow:
            raise ValueError("fast must be < slow")
        self.fast, self.slow = fast, slow
        self.warmup = slow

    def generate(self, df):
        f, s = ta.sma(df["close"], self.fast), ta.sma(df["close"], self.slow)
        return (f > s).astype(float).where(s.notna(), 0.0)


class RsiReversion(Strategy):
    """Buy oversold dips inside an uptrend, sell on the bounce."""
    name = "rsi_reversion"

    def __init__(self, period: int = 14, buy_below: float = 30, sell_above: float = 55, trend_sma: int = 200):
        self.period, self.buy_below, self.sell_above, self.trend_sma = period, buy_below, sell_above, trend_sma
        self.warmup = max(period, trend_sma)

    def generate(self, df):
        r = ta.rsi(df["close"], self.period).to_numpy()
        if self.trend_sma:
            trend_ok = (df["close"] > ta.sma(df["close"], self.trend_sma)).to_numpy()
        else:
            trend_ok = np.ones(len(df), dtype=bool)
        out = np.zeros(len(df))
        holding = False
        for i in range(len(df)):
            if np.isnan(r[i]):
                continue
            if not holding and r[i] < self.buy_below and trend_ok[i]:
                holding = True
            elif holding and r[i] > self.sell_above:
                holding = False
            out[i] = 1.0 if holding else 0.0
        return pd.Series(out, index=df.index)


def ml_features(df: pd.DataFrame) -> pd.DataFrame:
    c = df["close"]
    r1 = c.pct_change()
    vol_mean = df["volume"].rolling(20).mean()
    vol_std = df["volume"].rolling(20).std().replace(0, np.nan)
    return pd.DataFrame({
        "ret_1": r1,
        "ret_5": c.pct_change(5),
        "ret_10": c.pct_change(10),
        "ret_20": c.pct_change(20),
        "rsi_14": ta.rsi(c, 14) / 100,
        "dist_sma20": c / ta.sma(c, 20) - 1,
        "dist_sma50": c / ta.sma(c, 50) - 1,
        "sma20_vs_50": ta.sma(c, 20) / ta.sma(c, 50) - 1,
        "volatility_20": r1.rolling(20).std(),
        "atr_pct": ta.atr(df, 14) / c,
        "bb_pct": ta.bollinger_pct(c, 20),
        "volume_z": (df["volume"] - vol_mean) / vol_std,
        "range_pct": (df["high"] - df["low"]) / c,
    }, index=df.index).replace([np.inf, -np.inf], np.nan)


class MLStrategy(Strategy):
    """Gradient-boosted classifier predicting 'is price higher in `horizon` bars?'.

    Walk-forward: retrain every `retrain_every` bars using ONLY rows whose
    future label was already known at that time (row j needs close[j+horizon],
    so a model trained at bar i uses rows j <= i - horizon). This is the part
    most YouTube trading-bot tutorials get wrong, and it's why their backtests
    look like money printers.
    """
    name = "ml"

    def __init__(self, horizon: int = 5, min_return: float = 0.0, threshold: float = 0.55,
                 train_window: int = 750, retrain_every: int = 20, min_train: int = 250, seed: int = 0):
        self.horizon, self.min_return, self.threshold = horizon, min_return, threshold
        self.train_window, self.retrain_every, self.min_train, self.seed = train_window, retrain_every, min_train, seed
        self.warmup = 50 + min_train + horizon
        self.last_proba: pd.Series | None = None

    def _model(self):
        from sklearn.ensemble import HistGradientBoostingClassifier

        return HistGradientBoostingClassifier(max_iter=150, learning_rate=0.05, max_depth=3,
                                              l2_regularization=1.0, early_stopping=False,
                                              random_state=self.seed)

    def generate(self, df):
        X = ml_features(df)
        fwd = df["close"].shift(-self.horizon) / df["close"] - 1
        y = (fwd > self.min_return).astype(float).where(fwd.notna())
        Xv, yv = X.to_numpy(), y.to_numpy()
        valid_x = ~np.isnan(Xv).any(axis=1)
        n = len(df)
        proba = np.full(n, np.nan)
        model = None
        for i in range(n):
            if i % self.retrain_every == 0:
                hi = i - self.horizon  # last row whose label is known at bar i
                lo = max(0, hi - self.train_window + 1)
                if hi >= 0:
                    rows = np.arange(lo, hi + 1)
                    rows = rows[valid_x[rows] & ~np.isnan(yv[rows])]
                    if len(rows) >= self.min_train and len(np.unique(yv[rows])) == 2:
                        model = self._model().fit(Xv[rows], yv[rows].astype(int))
            if model is not None and valid_x[i]:
                proba[i] = model.predict_proba(Xv[i:i + 1])[0, 1]
        self.last_proba = pd.Series(proba, index=df.index)
        return (self.last_proba >= self.threshold).astype(float)

    def latest(self, df):
        """Train once on the most recent labelled window and score only the last bar."""
        X = ml_features(df)
        fwd = df["close"].shift(-self.horizon) / df["close"] - 1
        y = (fwd > self.min_return).astype(float).where(fwd.notna())
        known = X.notna().all(axis=1) & y.notna()
        known.iloc[len(df) - self.horizon:] = False  # labels there aren't known yet
        train_X, train_y = X[known].tail(self.train_window), y[known].tail(self.train_window)
        last = X.iloc[[-1]]
        if len(train_y) < self.min_train or train_y.nunique() < 2 or last.isna().any(axis=None):
            return 0.0
        model = self._model().fit(train_X.to_numpy(), train_y.astype(int).to_numpy())
        p = float(model.predict_proba(last.to_numpy())[0, 1])
        self.last_proba = pd.Series([p], index=last.index)
        return 1.0 if p >= self.threshold else 0.0


class Ensemble(Strategy):
    """Long only when at least `min_votes` member strategies agree."""
    name = "ensemble"

    def __init__(self, members: list[Strategy], min_votes: int = 2):
        if not 1 <= min_votes <= len(members):
            raise ValueError("min_votes must be between 1 and number of members")
        self.members, self.min_votes = members, min_votes
        self.warmup = max(m.warmup for m in members)

    def generate(self, df):
        votes = sum((m.generate(df) > 0).astype(int) for m in self.members)
        return (votes >= self.min_votes).astype(float)

    def latest(self, df):
        votes = sum(m.latest(df) > 0 for m in self.members)
        return 1.0 if votes >= self.min_votes else 0.0


REGISTRY = {"sma_cross": SmaCross, "rsi_reversion": RsiReversion, "ml": MLStrategy}


def build_strategy(name: str, params: dict | None = None) -> Strategy:
    params = params or {}
    if name == "ensemble":
        cfg = params.get("ensemble", {})
        names = cfg.get("members", ["sma_cross", "rsi_reversion", "ml"])
        members = [build_strategy(m, params) for m in names]
        return Ensemble(members, cfg.get("min_votes", 2))
    if name not in REGISTRY:
        raise ValueError(f"unknown strategy {name!r}; choose from {sorted(REGISTRY) + ['ensemble']}")
    return REGISTRY[name](**params.get(name, {}))
