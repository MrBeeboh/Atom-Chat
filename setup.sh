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

# ── 6. Desktop icon + command-line launcher ─────────────────────
echo ""
echo -e "${BOLD}6. Desktop launcher & shell command…${RESET}"
chmod +x "$ROOT/start-atom.sh" "$ROOT/scripts/start-atom.sh" "$ROOT/start-all.sh" 2>/dev/null || true

BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
ATOM_BIN="$BIN_DIR/atom"
cat > "$ATOM_BIN" <<EOF
#!/usr/bin/env bash
exec "$ROOT/start-atom.sh" "\$@"
EOF
chmod +x "$ATOM_BIN"
echo "  ✓ Command installed: atom  (runs $ROOT/start-atom.sh)"
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo -e "  ${YELLOW}! Add ~/.local/bin to your PATH if 'atom' is not found:${RESET}"
  echo "    echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc && source ~/.bashrc"
fi

DESKTOP_FILE="$ROOT/ATOM.desktop"
write_desktop() {
  local dest="$1"
  if [ -f "$DESKTOP_FILE" ]; then
    sed "s|__ATOM_ROOT__|$ROOT|g" "$DESKTOP_FILE" > "$dest"
  else
    cat > "$dest" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=ATOM Chat
Comment=Local AI chat — voice, search, and UI
Exec=$ROOT/start-atom.sh
Path=$ROOT
Terminal=true
Icon=utilities-terminal
Categories=Development;Network;
EOF
  fi
  chmod +x "$dest"
}

if [ -d "$HOME/.local/share/applications" ] || mkdir -p "$HOME/.local/share/applications" 2>/dev/null; then
  DEST="$HOME/.local/share/applications/ATOM.desktop"
  write_desktop "$DEST"
  echo "  ✓ Menu launcher created ($DEST)"
  if [ -d "$HOME/Desktop" ]; then
    write_desktop "$HOME/Desktop/ATOM.desktop"
    echo "  ✓ Desktop shortcut copied to $HOME/Desktop/ATOM.desktop"
  fi
else
  echo "  - Could not write a .desktop file. Start with: $ROOT/start-atom.sh"
fi

# ── 7. Done ───────────────────────────────────────────────────────
echo ""
echo -e "  ${BOLD}${GREEN}✓ Setup complete!${RESET}"
echo ""
echo "  Repo folder: $ROOT"
echo ""
echo "  Start ATOM (from anywhere, after ~/.local/bin is on PATH):"
echo "    atom"
echo "    ATOM_CLEAN_PORTS=1 atom    # if a stale Vite is holding the port"
echo ""
echo "  Or from this folder:"
echo "    ./start-atom.sh"
echo "    npm run start"
echo ""
echo "  Dev only (no voice/search):"
echo "    npm run dev"
echo ""
echo "  If the browser does not open, go to http://localhost:5173"
echo "  Errors stay on screen and are also written to atom-start.log"
