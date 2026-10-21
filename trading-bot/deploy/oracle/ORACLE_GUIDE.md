# Running tradebot on Oracle Cloud (free, doable entirely from an iPhone)

**End result:** a small free Linux server in Oracle's cloud runs the bot every day at
3:50pm New York time. Your laptop can stay off.

Total time: about 30-45 minutes, mostly waiting on installs.

---

## Before you start: 3 things to know

1. **Oracle requires a real credit or debit card to sign up**, even for the free tier.
   They place a small temporary hold to verify you're a real person. Prepaid and virtual cards
   are usually rejected. Free resources are labelled **"Always Free-eligible"**; stick to those.
2. **Oracle can delete free servers that look idle.** If CPU, network and memory use all stay
   below a low threshold (about 20%) for 7 days, the server can be reclaimed. This bot runs
   for ~2 minutes a day, so it **will** look idle. See *Step 7* for how to deal with it.
3. **You can't change your "home region" after signup.** Free ARM servers are often
   "out of capacity" in busy regions. Pick a region near you; if ARM is full, the AMD micro
   server in Step 2 works fine for this bot.

---

## Step 1: Sign up
1. On your iPhone, go to **oracle.com/cloud/free** → **Start for free**.
2. Fill in details, pick your **home region**, verify the card.
3. Wait for the "account ready" email (minutes to an hour).

## Step 2: Create the server
In the Oracle Cloud console (desktop mode in Safari helps: **aA → Request Desktop Website**):

1. Menu ☰ → **Compute → Instances → Create instance**.
2. **Name:** `tradebot`
3. **Image:** click *Change image* → **Canonical Ubuntu 24.04**.
4. **Shape:** click *Change shape*:
   - First try **Ampere → VM.Standard.A1.Flex**, set **1 OCPU, 6 GB memory**.
   - If creation fails with *"Out of capacity"*: use **Specialty and previous generation →
     VM.Standard.E2.1.Micro** (AMD, 1 GB RAM). The setup script adds swap so it copes.
   - Either way, make sure it says **Always Free-eligible**.
5. **SSH keys:** choose **Generate a key pair for me** → tap **Save private key**.
   Save it to the Files app (e.g. *iCloud Drive/Keys/tradebot.key*). **Don't lose this file;**
   it's the only way into the server.
6. Tap **Create**. When it shows **Running**, copy the **Public IP address**.

## Step 3: Connect from your iPhone
Install **Termius** (free) from the App Store.

1. Termius → **Keychain → + → Import key** → pick `tradebot.key` from Files.
2. **Hosts → + New Host**:
   - Address: *the public IP*
   - Username: `ubuntu`
   - Key: the one you imported
3. Tap the host to connect. You should see a prompt like `ubuntu@tradebot:~$`.

*Alternative with no app:* the Oracle console has **Cloud Shell** (the `>_` icon at the top).
Upload the key via its gear menu, then:
`chmod 600 tradebot.key && ssh -i tradebot.key ubuntu@PUBLIC_IP`

## Step 4: Install the bot (one command)
Paste this into the terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/bellasdaddy30/aether-ai/claude/ai-trading-bot-3d0895/trading-bot/deploy/oracle/setup.sh | bash
```

It installs Python, downloads the bot, installs its packages, runs the tests, and turns on
the daily timer. **Expect:** `26 passed`, then a **Setup done** box.
On the AMD micro server, the package install can take 10-15 minutes. Keep Termius open.

## Step 5: Add your Alpaca PAPER keys
```bash
nano ~/tradebot/.env
```
Replace the two placeholder lines with your paper keys. Save with **Ctrl+O**, **Enter**, then
exit with **Ctrl+X** (Termius has a Ctrl key above the keyboard). Leave `TRADEBOT_ALLOW_LIVE=no`.

Optional, choose symbols/strategy:
```bash
nano ~/tradebot/config.yaml
```
Suggested crypto setup from earlier: `symbols: [SPY, BTC/USD, ETH/USD]`, `strategy: name: ensemble`.

## Step 6: Test it
```bash
cd ~/tradebot
.venv/bin/python -m tradebot status                  # should print your paper balance
.venv/bin/python -m tradebot run --once --dry-run    # shows decisions, sends nothing
systemctl list-timers tradebot.timer                 # shows the next scheduled run
```
If `status` prints a balance, you're done. The bot now runs every day at 3:50pm
New York time. Stocks are skipped on weekends and holidays; crypto trades every day.

## Step 7: Keep Oracle from deleting it

You have three honest options:

| Option | What it means |
|---|---|
| **A. Upgrade to Pay As You Go** (most reliable) | Console → Billing → Upgrade. Always Free resources stay $0, and idle reclamation is widely reported not to apply to paid accounts. **Risk:** if you create something that isn't free, you get billed. Protect yourself: **Billing → Budgets → create a $1 budget with an email alert.** |
| **B. Stay on free and accept the risk** | If it gets reclaimed, you lose only the server's logs. Your positions live at Alpaca, not on the server. Rebuilding is Steps 2-6 again (~30 min). Back up your `config.yaml` (Step 9). |
| **C. "Keep-busy" scripts** | Some people run scripts that waste CPU to look active. **Not recommended:** it works against Oracle's terms and may stop working at any time. |

My pick: **B while paper trading, A before you ever trade real money.**

## Step 8: Checking on it from your phone
Connect with Termius, then:
```bash
journalctl -u tradebot -n 50 --no-pager      # what the last runs printed
tail -20 ~/tradebot/logs/trades.csv          # orders placed
cd ~/tradebot && .venv/bin/python -m tradebot status
```
Or just open the **Alpaca app/dashboard** (Paper account) to see positions and orders.

Run it right now instead of waiting for the timer:
```bash
sudo systemctl start tradebot && journalctl -u tradebot -n 30 --no-pager
```

## Step 9: Updates, backups, stopping
- **Update the bot code:** re-run the Step 4 command. Your `.env`, `config.yaml`, logs and state are kept.
- **Change run time** (e.g. 15:30): `RUN_AT=15:30 bash ~/aether-ai/trading-bot/deploy/oracle/setup.sh`
- **Back up settings:** `cat ~/tradebot/config.yaml`, then copy the text into Notes. **Don't** paste `.env` into
  anything synced or shared; you can always regenerate Alpaca keys.
- **Pause the bot:** `sudo systemctl disable --now tradebot.timer`
- **Resume:** `sudo systemctl enable --now tradebot.timer`

## Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| "Out of capacity" creating the server | Region's free ARM pool is full | Use VM.Standard.E2.1.Micro, or retry ARM later |
| Termius: "Permission denied (publickey)" | Wrong username or key | Username must be `ubuntu`; re-import the key file you downloaded |
| Termius times out | Server stopped, or wrong IP | Console → Instances: check it's *Running* and the IP matches |
| Setup stops during `pip install` with "Killed" | Out of memory on the micro VM | Re-run the Step 4 command (swap is added on the first run) |
| `status` says keys not set | `.env` not saved | `cat ~/tradebot/.env` to check; redo Step 5 |
| `401` / `forbidden` | Live keys instead of paper, or a typo | Generate keys with the Alpaca dashboard set to **Paper** |
| No trades for days | Strategy says "stay out", which is normal | `journalctl -u tradebot -n 50` shows each run; "actions=none" is fine |

## Security basics (already handled, but know them)
- Login is by **key only**, with no password to guess. Never share `tradebot.key`.
- `.env` is readable only by your user (`chmod 600`).
- The bot opens **no ports**; it only makes outbound connections to Alpaca and Yahoo.
- Ubuntu installs security updates automatically.
