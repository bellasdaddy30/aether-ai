# START HERE: tradebot quick guide

## Summary (what this is)

A Python trading bot for **stocks/ETFs and crypto**. It:

1. **Backtests** strategies on free historical data (Yahoo Finance), including fees and slippage.
2. **Paper trades** (fake money) through a free Alpaca account.
3. Can trade **real money** only if you deliberately unlock it three separate ways.

It ships with four strategies:

| Name | What it does | Trades | Best for |
|---|---|---|---|
| `sma_cross` | Long while the 20-bar average is above the 50-bar average | Few | Trending markets; crypto (keeps fees low) |
| `rsi_reversion` | Buys oversold dips in an uptrend, sells the bounce | Very few | Index ETFs like SPY |
| `ml` | AI model (gradient boosting) predicts "up in 5 bars?" and retrains every 20 bars | Many | Experimenting; stocks (no commissions) |
| `ensemble` | Buys only when 2 of the 3 above agree | Medium | **Default. Most conservative.** |

Risk controls on every trade:
- At most 20% of the account in one symbol.
- About 1% of the account at risk per trade.
- 5% stop-loss and 15% take-profit.
- A 3% daily-loss kill switch that sells everything and pauses until the next day.
- No re-buying right after a stop-loss.

**Honest expectations:** most trading bots don't beat simply buying and holding an index fund.
This bot's job is to let you *find out* safely, without lying to you. On random data it makes
about 0%, which is correct. If you ever see a backtest showing huge returns, suspect a bug first.

---

## What it costs

| | Cost |
|---|---|
| Software | $0 (all open source) |
| Historical data | $0 (Yahoo Finance / Alpaca free feeds) |
| Paper trading | $0 |
| Real stock trades on Alpaca | $0 commission + tiny SEC/FINRA fees on sells (about 2 cents per $1,000 sold) + the bid-ask spread |
| Real crypto trades on Alpaca | 0.25% per market order at the lowest tier (about 0.5% per buy+sell round trip) |

You **must** use a broker for stocks (US law). For crypto you could use a decentralized
exchange, but it isn't cheaper for small trades and it's riskier. Stick with Alpaca.

---

## Best way to use it (follow these phases in order)

### Phase 0: Install (10 minutes)

**Linux / Ragnarok:**
```bash
unzip tradebot.zip && cd trading-bot
bash setup.sh
```
`setup.sh` creates a virtual environment, installs everything, makes your `config.yaml`
and `.env`, and runs the tests. **Expect: `26 passed`.**

Manual install instead:
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp config.example.yaml config.yaml && cp .env.example .env
python -m pytest -q
```

**Windows:** same commands, but activate with `.venv\Scripts\activate`.

Every new terminal: `cd trading-bot && source .venv/bin/activate` before running commands.

### Phase 1: Learn how it behaves offline (day 1)

```bash
python -m tradebot backtest --synthetic --symbols FAKE --compare sma_cross rsi_reversion ml ensemble
python -m tradebot run --demo
```
The first command backtests on random data, so all strategies should land near 0%.
The second replays fake prices through the *real* trading loop, so you can watch buys,
sells and stop-losses happen. Trades are logged to `logs/trades_demo.csv`.

### Phase 2: Backtest on real history (week 1)

```bash
python -m tradebot backtest --symbols SPY QQQ BTC/USD ETH/USD --compare sma_cross rsi_reversion ml ensemble --start 2018-01-01 --end 2023-01-01
```
For each result, check:
1. **Beat `buy_hold_return`?** Or at least a much smaller `max_drawdown` (worst drop)?
   If neither, the strategy is adding nothing.
2. **`trades` above ~50?** Fewer than that proves nothing.
3. **`sharpe` above 2?** That's suspicious, not good news.

Pick the strategy you like, then run it **once** on data it has never seen:
```bash
python -m tradebot backtest --symbols SPY BTC/USD --strategy ensemble --start 2023-01-01
```
If it falls apart there, it was overfit. Don't keep re-tuning until this period looks good,
because then you've just overfit to it too.

Save trades for a closer look: `--trades-out trades_{symbol}_{strategy}.csv`

### Phase 3: Paper trade (at least 2-3 months)

1. Sign up free at https://alpaca.markets. Switch the dashboard to **Paper Trading**,
   then **API Keys → Generate**.
2. Paste the keys into `.env`.
3. In `config.yaml`, set your `symbols` and `strategy.name`.
4. Run these in order:
```bash
python -m tradebot status                 # prints paper balance = keys work
python -m tradebot run --once --dry-run   # shows decisions, sends nothing
python -m tradebot run --once             # sends paper orders; check Alpaca dashboard
```
5. Automate it. Daily bars only need **one decision per day**, so use cron instead of
   leaving a loop running (`crontab -e`):
```cron
# Stocks: 3:50pm New York time, Mon-Fri, so orders fill before the close
CRON_TZ=America/New_York
50 15 * * 1-5  cd $HOME/trading-bot && .venv/bin/python -m tradebot run --once >> logs/cron.log 2>&1
```
   Crypto trades 24/7, so the same job also handles your crypto symbols. Because stock
   symbols are skipped while the market is closed, it's simplest to have one job at 15:50
   on weekdays. If you want crypto on weekends too, add a second line without `1-5`.
6. Once a week, compare `logs/trades.csv` and the Alpaca dashboard with what the backtest
   predicted. Large differences mean something isn't modelled right. Find out why before going further.

### Phase 4: Real money (only if Phase 3 actually worked)

- Start with money you could lose **entirely** without it hurting.
- Generate **live** API keys in Alpaca, put them in `.env`, set `TRADEBOT_ALLOW_LIVE=yes`.
- Run `python -m tradebot run --once --live`, then type `I ACCEPT THE RISK`.
  For cron, add `--yes` only after you've watched it work by hand several times.
- Keep the risk settings at default or tighter.

---

## Settings worth knowing (`config.yaml`)

| Setting | Default | Meaning |
|---|---|---|
| `symbols` | SPY, BTC/USD | What to trade. Crypto uses `BTC/USD` format. |
| `strategy.name` | ensemble | `sma_cross`, `rsi_reversion`, `ml`, `ensemble` |
| `risk.max_position_pct` | 0.20 | Max 20% of the account in one symbol |
| `risk.risk_per_trade` | 0.01 | Lose about 1% of the account if a stop hits |
| `risk.stop_loss_pct` | 0.05 | Sell if price drops 5% below entry |
| `risk.take_profit_pct` | 0.15 | Sell if price rises 15% above entry (0 = off) |
| `risk.max_daily_loss_pct` | 0.03 | Kill switch at -3% on the day |
| `backtest.crypto_fee_bps` | 25 | 0.25% crypto fee per trade (Alpaca market order) |
| `live.poll_seconds` | 300 | Seconds between checks when using `run` without `--once` |

---

## Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| `yfinance returned no data` | Typo in symbol, or no internet | Check the symbol on finance.yahoo.com. Crypto is `BTC/USD` (converted automatically). |
| `ALPACA_API_KEY ... not set` | `.env` missing or not in current folder | Run from inside `trading-bot/`, and check `.env` has your keys |
| `401` / `forbidden` from Alpaca | Live keys used in paper mode, or a typo | Generate keys while the dashboard is set to **Paper** |
| Stocks never trade | Market is closed | Normal. Run during US market hours (9:30-16:00 New York) |
| `only N bars, strategy needs > M` | Not enough history | Raise `history_bars` in config |
| `halted for the day by kill switch` | Daily loss limit hit | Working as intended. Resumes next UTC day. |
| Want to reset paper state | | Delete the `state/` folder (not your Alpaca account) |

## Known limitations

- Stop-losses are checked each run, **not** placed as orders at Alpaca. A price gap
  (overnight or weekend) can jump past them.
- Backtests run one symbol at a time. The live bot shares one account across symbols.
- The Alpaca order code is written for `alpaca-py` 0.44 but hasn't been run against a
  live paper account yet. That's what Phase 3, steps 4-5 are for.

## File map

```
trading-bot/
  START_HERE.md          <- this file
  README.md              <- technical details
  setup.sh               <- one-step install (Linux/macOS)
  config.example.yaml    <- copy to config.yaml
  .env.example           <- copy to .env, add Alpaca keys
  requirements.txt
  tradebot/
    __main__.py          <- command line (backtest / run / status)
    strategies.py        <- the 4 strategies, including the ML model
    risk.py              <- position sizing, stops, kill switch
    backtest.py          <- historical simulator + metrics
    live.py              <- the trading loop
    brokers.py           <- Alpaca + local fake broker
    data.py              <- price data loaders
    indicators.py        <- SMA, EMA, RSI, ATR, Bollinger
  tests/                 <- 26 tests, incl. no-cheating (lookahead) checks
```
