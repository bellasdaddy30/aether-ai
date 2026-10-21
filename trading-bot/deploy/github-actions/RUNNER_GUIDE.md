# Running tradebot on GitHub Actions (free, no card, no computer)

GitHub runs the bot once a day on its own servers and saves the results back into this repo.
Everything below can be done from Safari on your iPhone.

**Cost:** $0. Private repos get 2,000 free Actions minutes a month; each run takes ~2-3 minutes,
so a month uses about 60-90.

---

## 1. Add your Alpaca PAPER keys (one time)
GitHub's phone app can't edit secrets, so use Safari. Tap **aA → Request Desktop Website**.

1. Open this repo on github.com → **Settings** → **Secrets and variables** → **Actions**.
2. **New repository secret** → Name: `ALPACA_API_KEY` → paste your paper API key → **Add secret**.
3. Again: Name: `ALPACA_SECRET_KEY` → paste your paper secret → **Add secret**.

Secrets are encrypted. They never appear in the code or the logs, and not even you can view
them again (you can only replace them).

## 2. Test it by hand
1. **Actions** tab → **tradebot** (left list) → **Run workflow** → mode **dry-run** → **Run workflow**.
2. Wait ~2 minutes and refresh. Tap the run, scroll to the **Summary** section.
   - ✅ Green tick, and the summary shows `equity=...`: keys work, and the bot decided without sending orders.
   - ❌ Red X saying "Add ALPACA_API_KEY...": a secret is missing or misnamed (step 1).
   - ❌ Red X with `401`/`forbidden`: the keys are wrong, or they're live keys instead of paper.
3. Once dry-run works, run it again with mode **paper** to place real *paper* orders. Then check
   the Alpaca dashboard (Paper account).

## 3. It now runs every day on its own
- **When:** 19:30 UTC daily, which is **3:30pm New York in summer and 2:30pm in winter**.
  GitHub sometimes starts scheduled runs 5-30 minutes late, which is why it isn't 3:50.
- **Weekends/holidays:** stocks are skipped (market closed), crypto still trades.
- **Scheduled runs use mode `paper`.** This workflow can never trade real money; it doesn't pass `--live`.
- **If a run fails, GitHub emails you.**

## 4. Checking on it from your phone
- **Actions tab:** one entry per day; tap one to see its summary (equity, orders, errors).
- **`logs/trades.csv`** in the repo: every order the bot has placed.
- **Alpaca app/dashboard (Paper):** the real positions and orders.

Each run adds a small commit (`bot: run ...`) saving `state/` and `logs/`. That's how the bot
remembers things between runs, like the daily-loss kill switch or not re-buying right after a stop-loss.

## 5. Changing settings
Open `config.yaml` in the repo → pencil icon ✏️ → edit → **Commit changes**. The next run uses it.
Example: `symbols: [SPY, BTC/USD, ETH/USD]`, `strategy: name: ensemble`.

## 6. Pause / resume
**Actions** → **tradebot** → **⋯** (top right) → **Disable workflow**. Use **Enable workflow** to resume.

## Limits (honest)
- **Stops are checked once a day.** A crash mid-day isn't acted on until the next run.
- **Run times aren't exact** (GitHub queues scheduled jobs).
- **Keep this repo PRIVATE.** It contains your trade history and account balance.
