#!/usr/bin/env bash
# ============================================================
#  AETHER — Lubuntu Dev Environment Setup Script
#  Safe for 2-core CPU / 4GB RAM (Asus X401A)
#  Run: chmod +x scripts/setup.sh && bash scripts/setup.sh
# ============================================================
set -e

# Always run from the project root (one level up from scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"
echo "[AETHER] Project root: $PROJECT_ROOT"

YELLOW='\033[1;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[AETHER]${NC} $1"; }
ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERR]${NC} $1"; exit 1; }

echo ""
echo -e "${YELLOW}  ═══════════════════════════════════════${NC}"
echo -e "${YELLOW}      AETHER — Environment Setup          ${NC}"
echo -e "${YELLOW}  ═══════════════════════════════════════${NC}"
echo ""

# ── 0. RAM Check ────────────────────────────────────────────
TOTAL_MB=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
log "Detected ${TOTAL_MB}MB RAM"
if [ "$TOTAL_MB" -lt 3000 ]; then
  warn "Less than 3GB RAM detected. Performance may be limited."
fi

# ── 1. System packages ──────────────────────────────────────
log "Updating package list (apt)…"
sudo apt-get update -qq

log "Installing required system packages…"
sudo apt-get install -y -qq \
  curl \
  wget \
  git \
  build-essential \
  python3 \
  python3-pip \
  libsqlite3-dev \
  ca-certificates \
  gnupg \
  lsb-release

ok "System packages ready"

# ── 2. Node.js 20 LTS (via NodeSource) ─────────────────────
if command -v node &>/dev/null; then
  NODE_VER=$(node --version)
  log "Node.js already installed: ${NODE_VER}"
  MAJOR=$(echo "$NODE_VER" | cut -d. -f1 | tr -d 'v')
  if [ "$MAJOR" -lt 18 ]; then
    warn "Node.js is too old (need 18+). Upgrading…"
    INSTALL_NODE=true
  else
    INSTALL_NODE=false
  fi
else
  INSTALL_NODE=true
fi

if [ "$INSTALL_NODE" = true ]; then
  log "Installing Node.js 20 LTS…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - 2>/dev/null
  sudo apt-get install -y -qq nodejs
  ok "Node.js $(node --version) installed"
fi

# ── 3. npm config for low-memory ────────────────────────────
log "Configuring npm for low-memory environment…"
npm config set fund false
npm config set audit false
npm config set progress false
npm config set fetch-retries 3
npm config set fetch-retry-mintimeout 5000
ok "npm configured"

# ── 4. Install project dependencies ─────────────────────────
log "Installing Node.js dependencies (this may take a few minutes)…"
# Use --prefer-offline if cache exists, limit concurrent jobs
npm install --no-audit --no-fund --ignore-scripts 2>&1 | tail -5
ok "Dependencies installed"

# ── 5. Environment file ──────────────────────────────────────
if [ ! -f ".env" ]; then
  log "Creating .env from template…"
  cp .env.example .env

  # Auto-generate JWT secret
  JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
  sed -i "s/REPLACE_WITH_64_BYTE_HEX_STRING/${JWT_SECRET}/" .env
  ok ".env created with new JWT secret"
  echo ""
  warn "┌─────────────────────────────────────────────────┐"
  warn "│  REQUIRED: Fill in these API keys in .env:       │"
  warn "│                                                   │"
  warn "│  OPENROUTER_API_KEY  → openrouter.ai (free)      │"
  warn "│  REPLICATE_API_TOKEN → replicate.com (PAYG)      │"
  warn "│  ELEVENLABS_API_KEY  → elevenlabs.io (free tier) │"
  warn "│  STRIPE_SECRET_KEY   → stripe.com (no upfront)   │"
  warn "│  STRIPE_PRICE_*      → create in Stripe Dashboard │"
  warn "└─────────────────────────────────────────────────┘"
  echo ""
else
  ok ".env already exists — skipping"
fi

# ── 6. Database init ─────────────────────────────────────────
log "Initializing SQLite database…"
node server/db/init.js
ok "Database ready"

# ── 7. Swap check & recommendation ───────────────────────────
SWAP_MB=$(awk '/SwapTotal/ {printf "%d", $2/1024}' /proc/meminfo)
if [ "$SWAP_MB" -lt 1024 ]; then
  echo ""
  warn "Swap is ${SWAP_MB}MB. For 4GB RAM systems, 2GB swap is recommended."
  warn "Run these commands to add swap (optional but helpful):"
  echo ""
  echo "  sudo fallocate -l 2G /swapfile"
  echo "  sudo chmod 600 /swapfile"
  echo "  sudo mkswap /swapfile"
  echo "  sudo swapon /swapfile"
  echo "  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab"
  echo ""
fi

# ── 8. Low-memory kernel tweaks (optional) ───────────────────
log "Applying low-memory system hints (swappiness)…"
sudo sysctl -w vm.swappiness=10 &>/dev/null || true
sudo sysctl -w vm.dirty_ratio=15 &>/dev/null || true
ok "Kernel hints applied (vm.swappiness=10)"

# ── 9. Stripe CLI (optional, for webhook testing) ────────────
echo ""
log "Stripe CLI install (optional — for local webhook testing):"
echo "  Download from: https://github.com/stripe/stripe-cli/releases"
echo "  Then run: stripe listen --forward-to localhost:3000/api/stripe/webhook"
echo ""

# ── Done ─────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}  ═══════════════════════════════════════${NC}"
echo -e "${GREEN}      Setup Complete!                      ${NC}"
echo -e "${GREEN}  ═══════════════════════════════════════${NC}"
echo ""
echo -e "  1. Edit ${YELLOW}.env${NC} with your API keys"
echo -e "  2. Run:  ${CYAN}npm start${NC}"
echo -e "  3. Open: ${CYAN}http://localhost:3000${NC}"
echo ""
