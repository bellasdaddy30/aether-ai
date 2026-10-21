#!/usr/bin/env bash
# One-shot setup for tradebot on an Oracle Cloud (or any Ubuntu 22.04/24.04) VM.
# Run as the default "ubuntu" user:
#   curl -fsSL https://raw.githubusercontent.com/bellasdaddy30/aether-ai/claude/ai-trading-bot-3d0895/trading-bot/deploy/oracle/setup.sh | bash
# Safe to re-run: it updates the code and reinstalls the timer without touching .env, config.yaml, logs or state.
set -euo pipefail

REPO_URL=${REPO_URL:-https://github.com/bellasdaddy30/aether-ai.git}
BRANCH=${BRANCH:-claude/ai-trading-bot-3d0895}
SRC=$HOME/aether-ai
APP=$HOME/tradebot     # where the bot lives and runs
RUN_AT=${RUN_AT:-15:50}    # New York time, every day (stocks are skipped when the market is closed)

echo "==> installing system packages"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git rsync python3 python3-venv python3-pip >/dev/null

# The 1 GB AMD micro VM can run out of memory while pip installs pandas/scikit-learn. 2 GB swap fixes that.
if [ "$(free -m | awk '/^Mem:/{print $2}')" -lt 2000 ] && ! swapon --show | grep -q /swapfile; then
  echo "==> low RAM detected, adding 2 GB swap"
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "==> fetching code ($BRANCH)"
if [ -d "$SRC/.git" ]; then
  git -C "$SRC" fetch -q origin "$BRANCH" && git -C "$SRC" checkout -q -B "$BRANCH" "origin/$BRANCH"
else
  git clone -q -b "$BRANCH" --depth 1 "$REPO_URL" "$SRC"
fi

# Run from a separate folder so updates never overwrite your keys, settings, logs or state.
mkdir -p "$APP"
rsync -a --delete --exclude .venv --exclude .env --exclude config.yaml --exclude logs --exclude state \
  "$SRC/trading-bot/" "$APP/"

cd "$APP"
[ -d .venv ] || python3 -m venv .venv
echo "==> installing Python packages (5-15 min on the small VM)"
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt

[ -f config.yaml ] || cp config.example.yaml config.yaml
[ -f .env ] || { cp .env.example .env; chmod 600 .env; }
mkdir -p logs state

echo "==> running tests"
.venv/bin/python -m pytest -q

echo "==> installing daily timer ($RUN_AT America/New_York)"
sudo tee /etc/systemd/system/tradebot.service >/dev/null <<UNIT
[Unit]
Description=tradebot single trading decision
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
User=$(id -un)
WorkingDirectory=$APP
ExecStart=$APP/.venv/bin/python -m tradebot run --once
TimeoutStartSec=900
UNIT

sudo tee /etc/systemd/system/tradebot.timer >/dev/null <<UNIT
[Unit]
Description=Run tradebot daily

[Timer]
OnCalendar=*-*-* $RUN_AT:00 America/New_York
Persistent=false

[Install]
WantedBy=timers.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now tradebot.timer >/dev/null

cat <<MSG

======================================================================
 Setup done. Bot is in $APP
 The timer is ON, but the bot can't trade until you add your keys:

   nano $APP/.env          # paste Alpaca PAPER keys, Ctrl+O Enter Ctrl+X
   nano $APP/config.yaml   # optional: symbols / strategy

 Test it:
   cd $APP && .venv/bin/python -m tradebot status
   cd $APP && .venv/bin/python -m tradebot run --once --dry-run

 Check on it later:
   systemctl list-timers tradebot.timer      # next run time
   journalctl -u tradebot -n 50 --no-pager   # output of recent runs
   tail $APP/logs/trades.csv                 # orders placed
======================================================================
MSG
