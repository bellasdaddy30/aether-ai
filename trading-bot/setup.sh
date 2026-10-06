#!/usr/bin/env bash
# One-step setup for tradebot. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")"

PY=${PYTHON:-python3}
"$PY" -c 'import sys; assert sys.version_info >= (3, 10), "Python 3.10+ required"' \
  || { echo "Need Python 3.10 or newer (found: $($PY --version 2>&1))"; exit 1; }

if [ ! -d .venv ]; then
  echo "==> creating virtual environment"
  "$PY" -m venv .venv || { echo "venv failed. On Ubuntu/Lubuntu run: sudo apt install python3-venv"; exit 1; }
fi
# shellcheck disable=SC1091
source .venv/bin/activate

echo "==> installing packages (a few minutes the first time)"
pip install -q --upgrade pip
pip install -q -r requirements.txt

[ -f config.yaml ] || { cp config.example.yaml config.yaml; echo "==> created config.yaml"; }
[ -f .env ] || { cp .env.example .env; chmod 600 .env; echo "==> created .env (add your Alpaca PAPER keys)"; }
mkdir -p logs state

echo "==> running tests"
python -m pytest -q

cat <<'MSG'

Setup done. Next:
  source .venv/bin/activate
  python -m tradebot run --demo                 # watch it trade fake data
  python -m tradebot backtest --symbols SPY BTC/USD --compare sma_cross ml ensemble
Then read START_HERE.md, Phase 3, for paper trading.
MSG
