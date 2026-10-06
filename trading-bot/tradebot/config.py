"""Config loading. Defaults live here so a missing key never silently means 'no risk limit'."""
from __future__ import annotations

import copy
import os
from pathlib import Path

import yaml

DEFAULTS: dict = {
    "symbols": ["SPY"],
    "timeframe": "1Day",
    "history_bars": 600,
    "strategy": {"name": "sma_cross", "params": {}},
    "risk": {
        "max_position_pct": 0.20,
        "risk_per_trade": 0.01,
        "stop_loss_pct": 0.05,
        "take_profit_pct": 0.15,
        "max_daily_loss_pct": 0.03,
        "max_open_positions": 4,
        "min_order_usd": 5.0,
    },
    "backtest": {"initial_cash": 10_000, "fee_bps": 0, "crypto_fee_bps": 25, "slippage_bps": 5},
    "live": {
        "broker": "alpaca",
        "poll_seconds": 300,
        "journal_path": "logs/trades.csv",
        "state_path": "state/bot_state.json",
    },
}


def _merge(base: dict, override: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def load_config(path: str | None) -> dict:
    data = {}
    if path:
        p = Path(path)
        if not p.exists():
            raise FileNotFoundError(f"Config not found: {p} (copy config.example.yaml to config.yaml)")
        data = yaml.safe_load(p.read_text()) or {}
    return _merge(DEFAULTS, data)


def load_dotenv(path: str = ".env") -> None:
    """Minimal .env reader so we don't need python-dotenv. Existing env vars win."""
    p = Path(path)
    if not p.exists():
        return
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


def is_crypto(symbol: str) -> bool:
    s = symbol.upper()
    return "/" in s or s.endswith("-USD") or s.endswith("USDT")
