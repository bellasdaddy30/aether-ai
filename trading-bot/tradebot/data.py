"""Market data: yfinance (free, backtests), Alpaca (paper/live), CSV, and synthetic (tests/demo).

Every loader returns a DataFrame indexed by UTC timestamp with lowercase
columns: open, high, low, close, volume.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

from .config import is_crypto

COLS = ["open", "high", "low", "close", "volume"]


def _clean(df: pd.DataFrame) -> pd.DataFrame:
    if isinstance(df.columns, pd.MultiIndex):  # yfinance returns (field, ticker)
        df = df.copy()
        df.columns = df.columns.get_level_values(0)
    df = df.rename(columns=str.lower)
    missing = [c for c in COLS if c not in df.columns]
    if missing:
        raise ValueError(f"data missing columns: {missing}")
    df = df[COLS].astype(float)
    idx = pd.to_datetime(df.index)
    idx = idx.tz_localize("UTC") if idx.tz is None else idx.tz_convert("UTC")
    df.index = idx
    df = df[~df.index.duplicated(keep="last")].sort_index()
    return df.dropna(subset=["open", "high", "low", "close"])


def yahoo_symbol(symbol: str) -> str:
    return symbol.replace("/", "-") if is_crypto(symbol) else symbol


def alpaca_symbol(symbol: str) -> str:
    s = symbol.upper()
    if s.endswith("-USD"):
        return s.replace("-USD", "/USD")
    return s


def load_yfinance(symbol: str, start: str = "2018-01-01", end: str | None = None, interval: str = "1d") -> pd.DataFrame:
    import yfinance as yf

    df = yf.download(yahoo_symbol(symbol), start=start, end=end, interval=interval,
                     auto_adjust=True, progress=False)
    if df is None or df.empty:
        raise RuntimeError(f"yfinance returned no data for {symbol!r} (bad symbol or network blocked?)")
    return _clean(df)


def load_csv(path: str) -> pd.DataFrame:
    df = pd.read_csv(path)
    time_col = next((c for c in df.columns if c.lower() in ("date", "datetime", "timestamp", "time")), df.columns[0])
    df = df.set_index(time_col)
    return _clean(df)


def load_alpaca(symbol: str, bars: int, timeframe: str = "1Day",
                api_key: str | None = None, secret_key: str | None = None) -> pd.DataFrame:
    from alpaca.data.historical import CryptoHistoricalDataClient, StockHistoricalDataClient
    from alpaca.data.requests import CryptoBarsRequest, StockBarsRequest
    from alpaca.data.timeframe import TimeFrame

    tf = {"1Day": TimeFrame.Day, "1Hour": TimeFrame.Hour}[timeframe]
    # Calendar time to request. Stocks trade ~252 days/yr and ~7 hours/day, so over-request.
    if is_crypto(symbol):
        span = timedelta(days=bars) if timeframe == "1Day" else timedelta(hours=bars)
    else:
        span = timedelta(days=bars * 1.5 + 10) if timeframe == "1Day" else timedelta(days=bars / 7 * 1.5 + 5)
    start = datetime.now(timezone.utc) - span * 1.1
    sym = alpaca_symbol(symbol)

    if is_crypto(symbol):
        client = CryptoHistoricalDataClient(api_key, secret_key)  # crypto data needs no keys
        raw = client.get_crypto_bars(CryptoBarsRequest(symbol_or_symbols=sym, timeframe=tf, start=start)).df
    else:
        from alpaca.data.enums import DataFeed

        client = StockHistoricalDataClient(api_key, secret_key)
        # IEX is the free feed. SIP needs a paid data plan.
        raw = client.get_stock_bars(StockBarsRequest(symbol_or_symbols=sym, timeframe=tf, start=start,
                                                     feed=DataFeed.IEX)).df
    if raw.empty:
        raise RuntimeError(f"Alpaca returned no bars for {sym}")
    if isinstance(raw.index, pd.MultiIndex):
        raw = raw.xs(sym, level="symbol")
    return _clean(raw).tail(bars)


def synthetic(n: int = 1500, seed: int = 7, start: str = "2018-01-01", drift: float = 0.0004,
              vol: float = 0.015, freq: str = "D") -> pd.DataFrame:
    """Random-walk OHLCV with regime shifts. For tests and offline demos ONLY - it has no real edge to find."""
    rng = np.random.default_rng(seed)
    regime = np.repeat(rng.choice([-1, 1], size=n // 100 + 1), 100)[:n]
    rets = rng.normal(drift + regime * 0.0006, vol, n)
    close = 100 * np.exp(np.cumsum(rets))
    open_ = np.concatenate([[100.0], close[:-1]]) * np.exp(rng.normal(0, vol / 4, n))
    high = np.maximum(open_, close) * np.exp(np.abs(rng.normal(0, vol / 2, n)))
    low = np.minimum(open_, close) * np.exp(-np.abs(rng.normal(0, vol / 2, n)))
    volume = rng.lognormal(14, 0.4, n)
    idx = pd.date_range(start, periods=n, freq=freq, tz="UTC")
    return pd.DataFrame({"open": open_, "high": high, "low": low, "close": close, "volume": volume}, index=idx)
