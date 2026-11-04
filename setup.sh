#!/usr/bin/env bash
set -e

BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
CYAN="\033[36m"
RESET="\033[0m"

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# Write a launcher that runs this checkout, not a hardcoded older folder.
write_atom_launcher() {
  local dest="$1"
  local root_q
  root_q="$(printf '%q' "$ROOT")"
  mkdir -p "$(dirname "$dest")"
  cat > "$dest" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=ATOM Chat
Comment=Start this ATOM Chat checkout (Talk voice prompt included)
Exec=bash -c "cd ${root_q} && exec ./scripts/start-atom.sh"
Path=${ROOT}
Terminal=true
Icon=utilities-terminal
Categories=Development;
StartupNotify=true
EOF
  chmod +x "$dest"
  echo "  ✓ Launcher $dest"
  echo "    opens http://localhost:5175/ from ${ROOT}"
}

install_atom_launchers() {
  write_atom_launcher "$HOME/.local/share/applications/ATOM.desktop"
  if [ -d "$HOME/Desktop" ]; then
    write_atom_launcher "$HOME/Desktop/ATOM.desktop"
  fi
}

if [ "${1:-}" = "--launcher" ]; then
  echo "Installing ATOM Chat launcher for ${ROOT}"
  install_atom_launchers
  exit 0
fi

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

# ── 4. llama.cpp / model server check ─────────────────────────────
echo ""
echo -e "${BOLD}4. Model server…${RESET}"
if curl -s http://localhost:8080/v1/models &>/dev/null 2>&1; then
  echo "  ✓ llama-server detected on port 8080 (recommended for Intel Arc)"
elif curl -s http://localhost:1234/v1/models &>/dev/null 2>&1; then
  echo "  ✓ OpenAI-compatible server detected on port 1234 (LM Studio, etc.)"
else
  echo -e "  ${YELLOW}! No local model server detected on 8080 or 1234.${RESET}"
  echo "  ATOM needs a running llama-server (or LM Studio / Ollama)."
  echo ""
  echo "  Quick start with llama.cpp on Intel GPU (SYCL build recommended):"
  echo "    source /opt/intel/oneapi/setvars.sh   # Linux oneAPI"
  echo "    llama-server -m /path/to/model.gguf --port 8080 --n-gpu-layers 99"
  echo ""
  echo "  Or install LM Studio and enable its local server (port 1234)."
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
install_atom_launchers

# ── 7. Done ───────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}${GREEN}✓ Setup complete!${RESET}"
echo ""
echo "  Starting the app:"
echo "    npm run dev                      # dev server (no voice)"
echo "    npm run start                    # full stack (voice + search + UI)"
echo "    npx serve dist                   # production build (static)"
echo ""
echo "  The desktop launcher opens http://localhost:5175/ from this folder."
echo "  npm run dev uses http://localhost:5173 (a different saved-settings origin)."
