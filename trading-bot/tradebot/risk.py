"""Risk management. This module matters more than the strategy does.

A mediocre strategy with tight risk control survives. A brilliant one without it
eventually hits a bad week and goes to zero.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class RiskConfig:
    max_position_pct: float = 0.20
    risk_per_trade: float = 0.01
    stop_loss_pct: float = 0.05
    take_profit_pct: float = 0.15
    max_daily_loss_pct: float = 0.03
    max_open_positions: int = 4
    min_order_usd: float = 5.0

    @classmethod
    def from_dict(cls, d: dict) -> "RiskConfig":
        known = {k: v for k, v in (d or {}).items() if k in cls.__dataclass_fields__}
        cfg = cls(**known)
        cfg.validate()
        return cfg

    def validate(self):
        if not 0 < self.max_position_pct <= 1:
            raise ValueError("max_position_pct must be in (0, 1]; leverage is not supported")
        if not 0 < self.risk_per_trade <= 0.05:
            raise ValueError("risk_per_trade must be in (0, 0.05]; risking >5% per trade is how accounts die")
        if not 0 <= self.stop_loss_pct < 1 or not 0 <= self.take_profit_pct:
            raise ValueError("stop_loss_pct must be in [0, 1) and take_profit_pct >= 0")
        if not 0 < self.max_daily_loss_pct < 1:
            raise ValueError("max_daily_loss_pct must be in (0, 1)")


class RiskManager:
    def __init__(self, cfg: RiskConfig):
        self.cfg = cfg

    def position_notional(self, equity: float, exposure: float = 1.0) -> float:
        """Dollars to put in one position: capped by % of equity AND by risk-per-trade / stop distance."""
        if equity <= 0 or exposure <= 0:
            return 0.0
        notional = equity * self.cfg.max_position_pct * min(exposure, 1.0)
        if self.cfg.stop_loss_pct > 0:
            notional = min(notional, equity * self.cfg.risk_per_trade / self.cfg.stop_loss_pct)
        return notional if notional >= self.cfg.min_order_usd else 0.0

    def position_qty(self, equity: float, price: float, exposure: float = 1.0) -> float:
        return self.position_notional(equity, exposure) / price if price > 0 else 0.0

    def stop_price(self, entry: float) -> float | None:
        return entry * (1 - self.cfg.stop_loss_pct) if self.cfg.stop_loss_pct > 0 else None

    def take_price(self, entry: float) -> float | None:
        return entry * (1 + self.cfg.take_profit_pct) if self.cfg.take_profit_pct > 0 else None

    def check_exit(self, entry: float, open_: float, high: float, low: float) -> tuple[float, str] | None:
        """Did this bar hit the stop or target? Returns (fill_price, reason).

        Pessimistic by design: a gap through the stop fills at the open (worse than
        the stop), and if one bar touched both levels we assume the stop hit first.
        """
        stop, take = self.stop_price(entry), self.take_price(entry)
        if stop is not None and open_ <= stop:
            return open_, "stop_gap"
        if stop is not None and low <= stop:
            return stop, "stop_loss"
        if take is not None and open_ >= take:
            return open_, "take_profit"
        if take is not None and high >= take:
            return take, "take_profit"
        return None

    def daily_loss_breached(self, day_start_equity: float, equity: float) -> bool:
        return day_start_equity > 0 and equity <= day_start_equity * (1 - self.cfg.max_daily_loss_pct)

    def can_open(self, open_positions: int) -> bool:
        return open_positions < self.cfg.max_open_positions
