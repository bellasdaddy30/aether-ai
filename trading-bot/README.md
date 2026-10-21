# tradebot: AI trading bot for stocks + crypto

A paper-first trading bot in Python. It backtests strategies on free historical data,
then runs them against an **Alpaca paper account** (fake money, free, no credit card).
Stocks/ETFs and crypto run through the same code.

> New here? Open **START_HERE.md** first.
>
> **Read this first.** Most retail trading bots lose money, and an ML model that
> looks brilliant in a backtest is usually leaking future data or overfit to noise.
> This bot is built to catch those mistakes, not to promise profit. Run it on paper
> for months before you think about real money.

## What's in it

| Piece | File | What it does |
|---|---|---|
| Data | `tradebot/data.py` | yfinance (free, backtests), Alpaca (paper/live), CSV, synthetic |
| Strategies | `tradebot/strategies.py` | `sma_cross`, `rsi_reversion`, `ml` (gradient boosting, walk-forward), `ensemble` (voting) |
| Risk | `tradebot/risk.py` | position caps, risk-per-trade sizing, stop loss / take profit, daily-loss kill switch |
| Backtester | `tradebot/backtest.py` | fees, slippage, next-bar-open fills, pessimistic stop handling, buy-and-hold benchmark |
| Live loop | `tradebot/live.py` | uses completed bars only, persistent state, CSV trade journal, dry-run mode |
| Brokers | `tradebot/brokers.py` | Alpaca (paper or live) and a local fake broker |
| Tests | `tests/` | 26 tests, including **lookahead tests** that fail if any strategy peeks at future bars |

### The "AI" part

`ml` is a `HistGradientBoostingClassifier` (scikit-learn) trained on 13 technical
features to predict "will price be higher in N bars?" It retrains every 20 bars on
a rolling window, and **only on rows whose answer was already known at that time**.
Getting that wrong is the #1 reason trading-bot tutorials show fake 500% returns.
`tests/test_no_lookahead.py` enforces it, and also checks that the model can't
"predict" a pure random walk (a high score there would mean leakage).

## Setup (local / Linux)

```bash
cd trading-bot
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp config.example.yaml config.yaml
cp .env.example .env          # paste your Alpaca PAPER keys in here
python -m pytest -q           # expect: 26 passed
```

## Usage

```bash
# 1. Offline smoke test, no internet or account needed (random data, so expect ~0% returns)
python -m tradebot backtest --synthetic --symbols FAKE --compare sma_cross rsi_reversion ml ensemble

# 2. Real backtests on free Yahoo data
python -m tradebot backtest --symbols SPY QQQ BTC/USD --compare sma_cross ml ensemble --start 2018-01-01
python -m tradebot backtest --symbols SPY --strategy ml --trades-out trades_{symbol}_{strategy}.csv

# 3. Watch the live loop run offline (replays synthetic bars into a fake broker)
python -m tradebot run --demo

# 4. Paper trading on Alpaca (fake money)
python -m tradebot status                 # check keys + account
python -m tradebot run --once --dry-run   # one decision, no orders sent
python -m tradebot run --once             # one decision, places paper orders
python -m tradebot run                    # loop forever (poll_seconds in config)
```

**Run it in the cloud for free:** `deploy/github-actions/` (GitHub Actions, no card needed) or `deploy/oracle/ORACLE_GUIDE.md` (Oracle Always Free VM, needs a card for verification).

**Daily timeframe tip:** with `timeframe: 1Day` you only need one decision per day.
Instead of a 24/7 loop, schedule `python -m tradebot run --once` with cron, e.g. a few
minutes after the US close (stocks) and once a day for crypto. Free and low-power,
which suits an older box like Ragnarok.

```cron
# 16:10 New York time, Mon-Fri (set CRON_TZ or convert to your system's TZ)
10 16 * * 1-5  cd /path/to/trading-bot && .venv/bin/python -m tradebot run --once >> logs/cron.log 2>&1
```

Note: with `--once` after the close, stocks show "market closed" and are skipped.
For stocks, run it shortly **before** the close (e.g. 15:50) so the orders can fill.
The signal still uses completed bars only.

## Google Colab

Colab works for **backtesting and research**. It's a bad host for the live loop
(sessions die after idle time), so run paper trading on your own machine or via cron.

```python
# Cell 1: get the code
!git clone -b claude/ai-trading-bot-3d0895 https://github.com/bellasdaddy30/aether-ai.git
%cd aether-ai/trading-bot
!pip install -q -r requirements.txt
```
```python
# Cell 2: verify
!python -m pytest -q
```
```python
# Cell 3: backtest
!python -m tradebot backtest --symbols SPY BTC/USD --compare sma_cross ml ensemble
```

## Getting Alpaca paper keys (free)

1. Sign up at https://alpaca.markets (paper trading needs no deposit).
2. Switch the dashboard to **Paper Trading**, then **API Keys → Generate**.
3. Put them in `.env`. Paper keys can't touch real money.

Stock data comes from the free IEX feed. Crypto data needs no keys at all.

## How to read a backtest without fooling yourself

- **Compare to `buy_hold_return`.** If the strategy doesn't beat just holding, or
  doesn't beat it on a risk-adjusted basis (lower `max_drawdown`, higher `sharpe`),
  it's not adding anything.
- **Sharpe above ~2 on daily bars** is a red flag for a bug or overfitting, not a win.
- **Few trades = no evidence.** 10 trades proves nothing. You want hundreds.
- **Test out of sample.** Tune on 2018–2022, then run once on 2023+ and accept the result.
  If you keep tweaking until 2023+ looks good, you've just overfit to it too.
- **Paper trade before live.** Paper results that differ a lot from the backtest mean
  there's a modelling gap (fills, timing, data) worth finding.

## Safety rails (deliberate)

- Paper by default. Real money needs **all three**: `TRADEBOT_ALLOW_LIVE=yes` in `.env`,
  the `--live` flag, and typing `I ACCEPT THE RISK`.
- Long-only. No shorting, no leverage (`max_position_pct` above 1 is rejected).
- `risk_per_trade` above 5% is rejected.
- Daily-loss kill switch flattens everything and halts until the next UTC day.
- After a stop-loss, the bot won't re-buy until the signal resets to flat (no revenge trading).
- Any symbol that errors is skipped; the loop keeps running and logs the exception.

## Known limitations (honest list)

- **Stops are software stops**, checked each tick, not orders resting at the broker
  (Alpaca crypto doesn't support bracket orders). Gaps and fast moves can blow through them.
- Backtests run **one symbol at a time** with the full account. The live bot shares one
  account across symbols. Portfolio-level backtesting isn't built yet.
- yfinance hourly data only goes back ~730 days.
- Daily "day" boundaries use UTC, not exchange time.
- Live Alpaca order paths were written against `alpaca-py` 0.44 but **haven't been run
  against a real paper account yet**. Do `run --once --dry-run`, then `run --once`, and
  check the Alpaca dashboard before leaving it unattended.

## Ideas for next steps

- Portfolio backtester (multiple symbols sharing one cash balance)
- Walk-forward parameter optimisation with a held-out test period
- News/sentiment features from a local LLM (llama.cpp + Qwen) as extra ML inputs
- Discord/Telegram alerts on every trade and kill-switch event
- A small web dashboard reading `logs/trades.csv`
