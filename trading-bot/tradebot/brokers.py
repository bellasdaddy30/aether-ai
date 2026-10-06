"""Brokers: Alpaca (paper or live) and a local simulated broker for offline testing."""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

from .config import is_crypto


@dataclass
class Position:
    symbol: str
    qty: float
    avg_entry: float


def _floor(x: float, decimals: int = 6) -> float:
    f = 10 ** decimals
    return math.floor(x * f) / f


class Broker:
    paper = True

    def get_equity(self) -> float: ...
    def get_position(self, symbol: str) -> Position | None: ...
    def is_market_open(self, symbol: str) -> bool: ...
    def buy(self, symbol: str, qty: float, ref_price: float) -> str: ...
    def close(self, symbol: str, ref_price: float) -> str: ...


class AlpacaBroker(Broker):
    def __init__(self, api_key: str, secret_key: str, paper: bool = True):
        from alpaca.trading.client import TradingClient

        if not api_key or not secret_key:
            raise RuntimeError("ALPACA_API_KEY / ALPACA_SECRET_KEY not set (see .env.example)")
        self.client = TradingClient(api_key, secret_key, paper=paper)
        self.paper = paper
        self._clock_cache = None

    @staticmethod
    def _pos_symbol(symbol: str) -> str:
        return symbol.replace("/", "").replace("-", "")  # positions API uses BTCUSD, not BTC/USD

    def get_equity(self) -> float:
        return float(self.client.get_account().equity)

    def get_position(self, symbol):
        from alpaca.common.exceptions import APIError

        try:
            p = self.client.get_open_position(self._pos_symbol(symbol))
        except APIError as e:
            if "position does not exist" in str(e).lower() or getattr(e, "status_code", None) == 404:
                return None
            raise
        return Position(symbol, float(p.qty), float(p.avg_entry_price))

    def is_market_open(self, symbol):
        if is_crypto(symbol):
            return True
        return bool(self.client.get_clock().is_open)

    def buy(self, symbol, qty, ref_price):
        from alpaca.trading.enums import OrderSide, TimeInForce
        from alpaca.trading.requests import MarketOrderRequest

        sym = symbol.replace("-", "/") if is_crypto(symbol) else symbol
        # Crypto needs GTC/IOC; fractional stock orders must be DAY.
        tif = TimeInForce.GTC if is_crypto(symbol) else TimeInForce.DAY
        order = self.client.submit_order(MarketOrderRequest(symbol=sym, qty=_floor(qty), side=OrderSide.BUY,
                                                            time_in_force=tif))
        return str(order.id)

    def close(self, symbol, ref_price):
        order = self.client.close_position(self._pos_symbol(symbol))
        return str(getattr(order, "id", order))


class LocalBroker(Broker):
    """Fake broker that fills instantly at ref_price (+ slippage). State persists to a JSON file."""

    def __init__(self, state_path: str = "state/local_broker.json", initial_cash: float = 10_000,
                 slippage_bps: float = 5, fee_bps: float = 0):
        self.path = Path(state_path)
        self.slip, self.fee = slippage_bps / 1e4, fee_bps / 1e4
        if self.path.exists():
            s = json.loads(self.path.read_text())
        else:
            s = {"cash": initial_cash, "positions": {}, "marks": {}}
        self.cash = s["cash"]
        self.positions: dict[str, dict] = s["positions"]
        self.marks: dict[str, float] = s.get("marks", {})

    def _save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps({"cash": self.cash, "positions": self.positions, "marks": self.marks}, indent=2))

    def mark(self, symbol: str, price: float):
        self.marks[symbol] = price
        self._save()

    def get_equity(self):
        return self.cash + sum(p["qty"] * self.marks.get(s, p["avg_entry"]) for s, p in self.positions.items())

    def get_position(self, symbol):
        p = self.positions.get(symbol)
        return Position(symbol, p["qty"], p["avg_entry"]) if p else None

    def is_market_open(self, symbol):
        return True

    def buy(self, symbol, qty, ref_price):
        fill = ref_price * (1 + self.slip)
        cost = fill * qty * (1 + self.fee)
        if cost > self.cash + 1e-9:
            raise RuntimeError(f"insufficient cash: need {cost:.2f}, have {self.cash:.2f}")
        self.cash -= cost
        old = self.positions.get(symbol)
        if old:
            new_qty = old["qty"] + qty
            old["avg_entry"] = (old["avg_entry"] * old["qty"] + fill * qty) / new_qty
            old["qty"] = new_qty
        else:
            self.positions[symbol] = {"qty": qty, "avg_entry": fill}
        self.marks[symbol] = ref_price
        self._save()
        return f"local-buy-{symbol}"

    def close(self, symbol, ref_price):
        p = self.positions.pop(symbol, None)
        if p:
            fill = ref_price * (1 - self.slip)
            self.cash += fill * p["qty"] * (1 - self.fee)
            self.marks[symbol] = ref_price
            self._save()
        return f"local-sell-{symbol}"
