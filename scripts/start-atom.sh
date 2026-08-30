#!/usr/bin/env bash
# Atom Chat launcher (Linux Mint desktop icon + npm run start)
# Voice (8765) + search (5174) + Vite. Keeps the terminal open if something fails
# so the red error is readable instead of a flash.

hold() {
  echo ""
  echo "ATOM stopped. Full log: ${LOG:-$ROOT/atom-start.log}"
  if [ -t 0 ]; then
    echo "Press Enter to close this window."
    read -r _ || true
  else
    sleep 8
  fi
}

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || { echo "Cannot open $ROOT"; hold; exit 1; }
LOG="$ROOT/atom-start.log"
{
  echo "========== $(date -Iseconds) =========="
  echo "cwd=$ROOT"
  echo "user=$(whoami)  DISPLAY=${DISPLAY:-<empty>}"
} >>"$LOG"

echo "[ATOM] Atom Chat — $ROOT"
echo "[ATOM] Log: $LOG"

if ! command -v node >/dev/null 2>&1; then
  echo "[ATOM] ERROR: Node.js is not on PATH. Install Node 18+ then try again." | tee -a "$LOG"
  hold
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "[ATOM] ERROR: npm is not on PATH." | tee -a "$LOG"
  hold
  exit 1
fi

if [ ! -d "$ROOT/node_modules/vite" ]; then
  echo "[ATOM] Installing npm dependencies (first run or missing node_modules)..."
  if ! npm install --no-audit --no-fund --legacy-peer-deps >>"$LOG" 2>&1; then
    echo "[ATOM] ERROR: npm install failed. See $LOG" | tee -a "$LOG"
    hold
    exit 1
  fi
fi

# Optional Origin sync — never abort launch
if [ -z "${ATOM_SKIP_SYNC:-}" ] && [ -d .git ] && command -v git >/dev/null 2>&1; then
  SYNC_BRANCH="${ATOM_SYNC_BRANCH:-main}"
  echo "[ATOM] Checking Origin for updates (origin/$SYNC_BRANCH)..."
  git fetch --quiet origin "$SYNC_BRANCH" >>"$LOG" 2>&1 || true
fi

# Voice (optional)
VOICE_DIR="$ROOT/voice-server"
if [ -f "$VOICE_DIR/app.py" ] && [ -x "$VOICE_DIR/.venv/bin/uvicorn" ]; then
  (cd "$VOICE_DIR" && nohup .venv/bin/uvicorn app:app --host 0.0.0.0 --port 8765 >>"$ROOT/voice-server.log" 2>&1 &)
  echo "[ATOM] Voice server on http://localhost:8765"
fi

# Search proxy (optional)
if [ -f "$ROOT/scripts/search-proxy.mjs" ] && command -v node >/dev/null 2>&1; then
  nohup node "$ROOT/scripts/search-proxy.mjs" >>"$ROOT/search-proxy.log" 2>&1 &
  echo "[ATOM] Search proxy on http://localhost:5174"
fi

port_free() {
  local p="$1"
  if command -v ss >/dev/null 2>&1; then
    ! ss -ltn 2>/dev/null | grep -qE ":${p}[[:space:]]"
  elif command -v lsof >/dev/null 2>&1; then
    ! lsof -Pi :"$p" -sTCP:LISTEN -t >/dev/null 2>&1
  else
    return 0
  fi
}

PORT="${ATOM_UI_PORT:-}"
if [ -z "$PORT" ]; then
  for try in 5175 5173 5176; do
    if port_free "$try"; then
      PORT="$try"
      break
    fi
  done
  PORT="${PORT:-5175}"
fi

echo "[ATOM] Starting UI on http://localhost:${PORT}/"
if [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; then
  (sleep 3 && xdg-open "http://localhost:${PORT}/" >>"$LOG" 2>&1) &
fi

echo ""
echo "Leave this window open. Press Ctrl+C to stop."
echo ""

# Do not use exec — if Vite exits we hold the window so the red error stays.
if ! npm run dev -- --port "$PORT" 2>>"$LOG"; then
  echo "[ATOM] ERROR: Vite/npm exited. Last 30 lines of $LOG:" | tee -a "$LOG"
  tail -n 30 "$LOG"
  hold
  exit 1
fi
