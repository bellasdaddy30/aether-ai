"""CLI.  Run `python -m tradebot --help`."""
from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import datetime, timedelta, timezone

from . import data as D
from .backtest import format_metrics, periods_per_year, run_backtest
from .config import is_crypto, load_config, load_dotenv
from .risk import RiskConfig, RiskManager
from .strategies import build_strategy

LIVE_WARNING = """
================================================================
  LIVE TRADING WITH REAL MONEY
  - Most retail trading bots lose money, especially after fees.
  - A good backtest does not mean future profit.
  - Only trade money you can afford to lose completely.
================================================================
"""


def _strategy(cfg, name=None):
    s = cfg["strategy"]
    return build_strategy(name or s["name"], s.get("params", {}))


def _load_hist(args, symbol, cfg):
    if args.csv:
        return D.load_csv(args.csv)
    if args.synthetic:
        return D.synthetic(n=args.bars or 1500, seed=args.seed)
    interval = "1h" if cfg["timeframe"] == "1Hour" else "1d"
    return D.load_yfinance(symbol, start=args.start, end=args.end, interval=interval)


def cmd_backtest(args, cfg):
    risk = RiskManager(RiskConfig.from_dict(cfg["risk"]))
    bt = cfg["backtest"]
    symbols = args.symbols or cfg["symbols"]
    names = args.compare or [args.strategy or cfg["strategy"]["name"]]
    for symbol in symbols:
        df = _load_hist(args, symbol, cfg)
        crypto = is_crypto(symbol)
        print(f"\n=== {symbol}  {df.index[0].date()} -> {df.index[-1].date()}  ({len(df)} bars) ===")
        for name in names:
            strat = _strategy(cfg, name)
            res = run_backtest(df, strat, risk, bt["initial_cash"],
                               fee_bps=bt["crypto_fee_bps"] if crypto else bt["fee_bps"],
                               slippage_bps=bt["slippage_bps"], ppy=periods_per_year(cfg["timeframe"], crypto))
            print(f"\n[{name}]")
            print(format_metrics(res.metrics))
            if args.trades_out:
                path = args.trades_out.replace("{symbol}", symbol.replace("/", "-")).replace("{strategy}", name)
                res.trades_frame().to_csv(path, index=False)
                print(f"  trades written to {path}")
    print("\nReminder: past performance (especially backtested) does not predict future results.")


def _build_bot(args, cfg, live_money: bool):
    from .brokers import AlpacaBroker, LocalBroker
    from .live import Bot

    live = cfg["live"]
    risk = RiskManager(RiskConfig.from_dict(cfg["risk"]))
    strat = _strategy(cfg, args.strategy)
    symbols = args.symbols or cfg["symbols"]
    n = cfg["history_bars"]

    if args.demo:
        # Replay synthetic history through the real loop: each tick reveals one more bar.
        hist = {s: D.synthetic(n=n + 300, seed=i + args.seed) for i, s in enumerate(symbols)}
        cursor = {"i": n}

        def data_fn(sym):
            return hist[sym].iloc[: cursor["i"]]

        def clock():
            df = next(iter(hist.values()))
            return (df.index[cursor["i"] - 1] + timedelta(days=1)).to_pydatetime()

        broker = LocalBroker(live["state_path"].replace(".json", "_demo_broker.json"),
                             cfg["backtest"]["initial_cash"])
        bot = Bot(symbols, strat, risk, broker, data_fn, cfg["timeframe"],
                  live["journal_path"].replace(".csv", "_demo.csv"),
                  live["state_path"].replace(".json", "_demo.json"), dry_run=args.dry_run, clock=clock)
        bot._demo_cursor = cursor
        return bot

    if live["broker"] == "local":
        broker = LocalBroker(live["state_path"].replace(".json", "_local_broker.json"),
                             cfg["backtest"]["initial_cash"])
        hourly = cfg["timeframe"] == "1Hour"
        # yfinance only serves ~730 days of hourly data
        days = min(729, n // 6 + 30) if hourly else int(n * 1.6) + 10
        start = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
        data_fn = lambda s: D.load_yfinance(s, start=start, interval="1h" if hourly else "1d").tail(n)  # noqa: E731
    else:
        key, secret = os.getenv("ALPACA_API_KEY"), os.getenv("ALPACA_SECRET_KEY")
        broker = AlpacaBroker(key, secret, paper=not live_money)
        data_fn = lambda s: D.load_alpaca(s, n, cfg["timeframe"], key, secret)  # noqa: E731

    return Bot(symbols, strat, risk, broker, data_fn, cfg["timeframe"], live["journal_path"], live["state_path"],
               dry_run=args.dry_run)


def cmd_run(args, cfg):
    live_money = bool(args.live)
    if live_money:
        if os.getenv("TRADEBOT_ALLOW_LIVE", "").strip().lower() != "yes":
            sys.exit("Refusing live trading: set TRADEBOT_ALLOW_LIVE=yes in .env as well as passing --live.")
        if cfg["live"]["broker"] != "alpaca":
            sys.exit("--live only makes sense with broker: alpaca")
        print(LIVE_WARNING)
        if not args.yes and input("Type 'I ACCEPT THE RISK' to continue: ").strip() != "I ACCEPT THE RISK":
            sys.exit("Aborted.")

    bot = _build_bot(args, cfg, live_money)
    if args.demo:
        for _ in range(args.ticks or 120):
            s = bot.tick()
            if s["actions"]:
                print(f"{bot.clock().date()} equity={s['equity']:.2f} {s['actions']}")
            bot._demo_cursor["i"] += 1
        print(f"\nDemo finished. Final equity: {bot.broker.get_equity():.2f}  "
              f"(journal: {bot.journal_path})")
        return
    if args.once:
        s = bot.tick()
        print(f"equity={s['equity']:.2f} actions={s['actions'] or 'none'}")
        return
    bot.run(cfg["live"]["poll_seconds"], max_ticks=args.ticks)


def cmd_status(args, cfg):
    from .brokers import AlpacaBroker

    broker = AlpacaBroker(os.getenv("ALPACA_API_KEY"), os.getenv("ALPACA_SECRET_KEY"), paper=True)
    print(f"paper account equity: {broker.get_equity():.2f}")
    for s in args.symbols or cfg["symbols"]:
        p = broker.get_position(s)
        print(f"  {s:<10} {'flat' if not p else f'{p.qty:.6f} @ {p.avg_entry:.4f}'}")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="tradebot", description="Paper-first stock + crypto trading bot")
    ap.add_argument("-c", "--config", default="config.yaml" if os.path.exists("config.yaml") else None)
    ap.add_argument("-v", "--verbose", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("backtest", help="test a strategy on historical data")
    b.add_argument("--symbols", nargs="+")
    b.add_argument("--strategy")
    b.add_argument("--compare", nargs="+", help="backtest several strategies side by side")
    b.add_argument("--start", default="2018-01-01")
    b.add_argument("--end")
    b.add_argument("--csv", help="use a local OHLCV CSV instead of downloading")
    b.add_argument("--synthetic", action="store_true", help="use fake random data (offline smoke test)")
    b.add_argument("--bars", type=int)
    b.add_argument("--seed", type=int, default=7)
    b.add_argument("--trades-out", help="write trades CSV, e.g. trades_{symbol}_{strategy}.csv")

    r = sub.add_parser("run", help="run the trading loop (paper by default)")
    r.add_argument("--symbols", nargs="+")
    r.add_argument("--strategy")
    r.add_argument("--once", action="store_true", help="single tick then exit (for cron)")
    r.add_argument("--ticks", type=int)
    r.add_argument("--dry-run", action="store_true", help="decide but never send orders")
    r.add_argument("--demo", action="store_true", help="offline: replay synthetic bars into a local fake broker")
    r.add_argument("--seed", type=int, default=7)
    r.add_argument("--live", action="store_true", help="REAL MONEY. Also needs TRADEBOT_ALLOW_LIVE=yes")
    r.add_argument("--yes", action="store_true", help="skip the interactive live confirmation")

    s = sub.add_parser("status", help="show Alpaca paper account + positions")
    s.add_argument("--symbols", nargs="+")

    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    for noisy in ("urllib3", "yfinance", "peewee"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    load_dotenv()
    cfg = load_config(args.config)
    {"backtest": cmd_backtest, "run": cmd_run, "status": cmd_status}[args.cmd](args, cfg)


if __name__ == "__main__":
    main()
