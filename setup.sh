#!/usr/bin/env bash
set -e

BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
CYAN="\033[36m"
RESET="\033[0m"

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo ""
echo -e "${BOLD}${CYAN}  ⚛  ATOM Chat — Setup${RESET}"
echo "  Local AI. No cloud. No compromise."
echo ""

# ── 1. Check prerequisites ───────────────────────────────────────
echo -e "${BOLD}1. Checking prerequisites…${RESET}"

if ! command -v node &>/dev/null; then
  echo "  ✗ Node.js not found. Install it: https://nodejs.org (v18+)"
  exit 1
fi
echo "  ✓ Node.js $(node -v)"

if ! command -v npm &>/dev/null; then
  echo "  ✗ npm not found. Node.js should include npm."
  exit 1
fi
echo "  ✓ npm $(npm -v)"

# ── 2. Install npm dependencies ───────────────────────────────────
echo ""
echo -e "${BOLD}2. Installing dependencies (npm install)…${RESET}"
npm install --loglevel=error
echo "  ✓ Dependencies installed"

# ── 3. Build the frontend ─────────────────────────────────────────
echo ""
echo -e "${BOLD}3. Building frontend…${RESET}"
npm run build
echo "  ✓ Build complete (output in dist/)"

# ── 4. LM Studio check ────────────────────────────────────────────
echo ""
echo -e "${BOLD}4. Model server…${RESET}"
LMS_FOUND=false
if command -v lms &>/dev/null; then
  LMS_FOUND=true
fi
if curl -s http://localhost:1234/v1/models &>/dev/null 2>&1; then
  LMS_FOUND=true
fi

if [ "$LMS_FOUND" = true ]; then
  echo "  ✓ LM Studio detected"
else
  echo -e "  ${YELLOW}! LM Studio not detected.${RESET}"
  echo "  ATOM needs a model server. Install LM Studio:"
  echo "    ${CYAN}https://lmstudio.ai${RESET}"
  echo ""
  echo "  After installing, open LM Studio, download a model, and enable"
  echo "  the local API server in the Developer tab (port 1234)."
  echo ""
  echo "  Recommended starter models:"
  echo "    — Qwen2.5-7B-Instruct (fast, good all-rounder)"
  echo "    — Llama-3.2-3B-Instruct (lightweight)"
  echo "    — DeepSeek-R1-Distill-Qwen-7B (reasoning)"
fi

# ── 5. Optional: voice server ────────────────────────────────────
echo ""
echo -e "${BOLD}5. Voice input (optional)…${RESET}"
VOICE_DIR="$ROOT/voice-server"
if [ -d "$VOICE_DIR" ] && [ -f "$VOICE_DIR/app.py" ]; then
  if command -v python3 &>/dev/null; then
    if [ ! -d "$VOICE_DIR/.venv" ]; then
      echo "  Setting up voice server (Python venv + deps)..."
      (cd "$VOICE_DIR" && python3 -m venv .venv && .venv/bin/python -m pip install -q -r requirements.txt 2>/dev/null) && \
        echo "  ✓ Voice server ready" || \
        echo -e "  ${YELLOW}! Voice server setup failed (ignored). Run manually: cd voice-server && python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt${RESET}"
    else
      echo "  ✓ Voice server already set up"
    fi
  else
    echo -e "  ${YELLOW}! python3 not found — skipping voice server. Install python3 for voice input.${RESET}"
  fi
else
  echo "  - No voice-server/ directory found — skipping"
fi

# ── 6. Desktop icon ──────────────────────────────────────────────
echo ""
echo -e "${BOLD}6. Desktop launcher…${RESET}"
DESKTOP_FILE="$ROOT/ATOM.desktop"
if [ -f "$DESKTOP_FILE" ]; then
  if [ -d "$HOME/Desktop" ] || [ -d "$HOME/.local/share/applications" ]; then
    DEST="$HOME/.local/share/applications/ATOM.desktop"
    mkdir -p "$HOME/.local/share/applications"
    sed "s|/home/mike/atom-chat|$ROOT|g" "$DESKTOP_FILE" > "$DEST"
    chmod +x "$DEST"
    echo "  ✓ Desktop launcher created ($DEST)"
  else
    echo "  - No Desktop directory — skipping. To create manually:"
    echo "    cp ATOM.desktop ~/.local/share/applications/"
    echo "    (edit the path inside to match: $ROOT)"
  fi
fi

# ── 7. Done ───────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}${GREEN}✓ Setup complete!${RESET}"
echo ""
echo "  Starting the app:"
echo "    npm run dev                      # dev server (no voice)"
echo "    npm run start                    # full stack (voice + search + UI)"
echo "    npx serve dist                   # production build (static)"
echo ""
echo "  Then open http://localhost:5173 and select a model."
