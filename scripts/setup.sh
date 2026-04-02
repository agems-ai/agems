#!/usr/bin/env bash
set -euo pipefail

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

ok()   { echo -e "  ${GREEN}✓${RESET} $1"; }
warn() { echo -e "  ${YELLOW}⚠${RESET} $1"; }
fail() { echo -e "  ${RED}✗${RESET} $1"; exit 1; }
info() { echo -e "  ${CYAN}i${RESET} $1"; }

# ── Banner ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║     AGEMS — Agent Management System      ║${RESET}"
echo -e "${BOLD}║         One-Click Setup Script            ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════╝${RESET}"
echo ""

# ── Step 1: Check Docker ────────────────────────────────────────────────────
echo -e "${BOLD}Step 1/4 — Checking prerequisites${RESET}"

if ! command -v docker &>/dev/null; then
  fail "Docker is not installed. Install it from https://docs.docker.com/get-docker/"
fi
ok "Docker found: $(docker --version | head -1)"

if ! docker compose version &>/dev/null; then
  fail "Docker Compose v2 is required. Update Docker or install docker-compose-plugin."
fi
ok "Docker Compose found: $(docker compose version --short)"

if ! docker info &>/dev/null 2>&1; then
  fail "Docker daemon is not running. Start Docker and try again."
fi
ok "Docker daemon is running"

# ── Step 2: Clone or update repo ────────────────────────────────────────────
echo ""
echo -e "${BOLD}Step 2/4 — Getting AGEMS${RESET}"

INSTALL_DIR="${AGEMS_DIR:-./agems}"

if [ -d "$INSTALL_DIR/.git" ]; then
  info "AGEMS directory already exists at $INSTALL_DIR"
  cd "$INSTALL_DIR"
  git pull --ff-only 2>/dev/null && ok "Updated to latest version" || warn "Could not pull updates (offline or dirty tree)"
else
  info "Cloning AGEMS..."
  git clone https://github.com/agems-ai/agems.git "$INSTALL_DIR"
  cd "$INSTALL_DIR"
  ok "Cloned to $INSTALL_DIR"
fi

# ── Step 3: Configure .env ──────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Step 3/4 — Configuration${RESET}"

if [ ! -f .env ]; then
  cp .env.example .env
  ok "Created .env from template"
else
  ok ".env already exists"
fi

# Generate JWT_SECRET if still default
if grep -q 'JWT_SECRET="change-me-in-production"' .env 2>/dev/null; then
  JWT=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | xxd -p | tr -d '\n' | head -c 64)
  sed -i "s/JWT_SECRET=\"change-me-in-production\"/JWT_SECRET=\"${JWT}\"/" .env
  ok "JWT_SECRET auto-generated"
fi

# Check for AI provider key
HAS_KEY=false
for KEY in ANTHROPIC_API_KEY OPENAI_API_KEY GOOGLE_AI_API_KEY; do
  VAL=$(grep "^${KEY}=" .env 2>/dev/null | cut -d= -f2 | tr -d '"' | tr -d "'")
  if [ -n "$VAL" ]; then
    HAS_KEY=true
    break
  fi
done

if [ "$HAS_KEY" = false ]; then
  echo ""
  warn "No AI provider API key found."
  info "AGEMS needs at least one AI key to work. Enter one below (or press Enter to skip):"
  echo ""
  read -rp "  ANTHROPIC_API_KEY: " ANTHROPIC_KEY
  if [ -n "$ANTHROPIC_KEY" ]; then
    sed -i "s/^ANTHROPIC_API_KEY=.*/ANTHROPIC_API_KEY=\"${ANTHROPIC_KEY}\"/" .env
    ok "Anthropic key saved"
  else
    read -rp "  OPENAI_API_KEY: " OPENAI_KEY
    if [ -n "$OPENAI_KEY" ]; then
      sed -i "s/^OPENAI_API_KEY=.*/OPENAI_API_KEY=\"${OPENAI_KEY}\"/" .env
      ok "OpenAI key saved"
    else
      read -rp "  GOOGLE_AI_API_KEY: " GOOGLE_KEY
      if [ -n "$GOOGLE_KEY" ]; then
        sed -i "s/^GOOGLE_AI_API_KEY=.*/GOOGLE_AI_API_KEY=\"${GOOGLE_KEY}\"/" .env
        ok "Google AI key saved"
      else
        warn "No key provided. Add one to .env later: nano .env"
      fi
    fi
  fi
fi

# ── Step 4: Start services ─────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Step 4/4 — Starting AGEMS${RESET}"

info "Pulling pre-built images (this may take 1-2 minutes)..."
docker compose pull 2>/dev/null || info "Pre-built images not available yet, will build locally"

info "Starting services..."
docker compose up -d

# Wait for health
echo ""
info "Waiting for services to be ready..."
TRIES=0
MAX_TRIES=60
while [ $TRIES -lt $MAX_TRIES ]; do
  if curl -sf http://localhost:3001/api/health &>/dev/null; then
    break
  fi
  TRIES=$((TRIES + 1))
  sleep 2
done

if [ $TRIES -lt $MAX_TRIES ]; then
  echo ""
  echo -e "${GREEN}${BOLD}══════════════════════════════════════════${RESET}"
  echo -e "${GREEN}${BOLD}  AGEMS is running!${RESET}"
  echo -e "${GREEN}${BOLD}══════════════════════════════════════════${RESET}"
  echo ""
  echo -e "  Web UI:    ${CYAN}http://localhost:3000${RESET}"
  echo -e "  API:       ${CYAN}http://localhost:3001${RESET}"
  echo -e "  Config:    ${CYAN}$(pwd)/.env${RESET}"
  echo ""
  echo -e "  ${BOLD}Commands:${RESET}"
  echo -e "    Stop:    ${CYAN}docker compose down${RESET}"
  echo -e "    Logs:    ${CYAN}docker compose logs -f${RESET}"
  echo -e "    Update:  ${CYAN}git pull && docker compose pull && docker compose up -d${RESET}"
  echo ""
else
  warn "Services started but health check timed out."
  info "Check logs: docker compose logs -f api"
  info "Common fix: make sure port 3001 is free and .env has valid DATABASE_URL"
fi
