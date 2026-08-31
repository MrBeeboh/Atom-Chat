#!/usr/bin/env bash
# ATOM Chat launcher (Linux Mint desktop icon, ./start-atom.sh, npm run start)
#
# Starts optional helpers, then Vite in the FOREGROUND so the terminal stays
# open. Never requires llama-server (LM Studio on :1234 is enough).
# Never uses `set -e` — a missing optional binary must not close the window.

hold() {
  echo ""
  echo "ATOM stopped. Full log: ${ATOM_LOG:-$ROOT/atom-start.log}"
  if [ -t 0 ] && [ -z "${ATOM_NO_HOLD:-}" ]; then
    echo "Press Enter to close this window."
    read -r _ || true
  elif [ -z "${ATOM_NO_HOLD:-}" ]; then
    echo "(window will stay open 12s so the error is readable)"
    sleep 12
  fi
}

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || { echo "Cannot open $ROOT"; sleep 8; exit 1; }

ATOM_LOG="${ATOM_LOG:-$ROOT/atom-start.log}"
export ATOM_LOG
# shellcheck source=atom-launcher-lib.sh
. "$ROOT/scripts/atom-launcher-lib.sh"

{
  echo "========== $(date -Iseconds) =========="
  echo "cwd=$ROOT"
  echo "user=$(whoami)  DISPLAY=${DISPLAY:-<empty>}  WAYLAND=${WAYLAND_DISPLAY:-<empty>}"
  echo "node=$(command -v node 2>/dev/null || echo MISSING)  npm=$(command -v npm 2>/dev/null || echo MISSING)"
} >>"$ATOM_LOG"

atom_log "[ATOM] Atom Chat — $ROOT"
atom_log "[ATOM] Log: $ATOM_LOG"

if [ "${1:-}" = "--check" ] || [ -n "${ATOM_LAUNCHER_CHECK:-}" ]; then
  echo "node: $(command -v node || echo MISSING)"
  echo "npm:  $(command -v npm || echo MISSING)"
  echo "vite modules: $([ -d "$ROOT/node_modules/vite" ] && echo ok || echo missing)"
  echo "llama-server: $(atom_resolve_llama_bin || echo 'not installed (ok — LM Studio is enough)')"
  echo "port 5173: $(atom_port_in_use 5173 && echo busy || echo free)"
  echo "port 1234: $(atom_port_in_use 1234 && echo busy || echo free)"
  echo "port 8080: $(atom_port_in_use 8080 && echo busy || echo free)"
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  atom_log "[ATOM] ERROR: Node.js is not on PATH. Install Node 18+ from https://nodejs.org"
  hold
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  atom_log "[ATOM] ERROR: npm is not on PATH."
  hold
  exit 1
fi

if [ ! -d "$ROOT/node_modules/vite" ]; then
  atom_log "[ATOM] Installing npm dependencies (first run or missing node_modules)..."
  if ! npm install --no-audit --no-fund --legacy-peer-deps >>"$ATOM_LOG" 2>&1; then
    atom_log "[ATOM] ERROR: npm install failed. See $ATOM_LOG"
    hold
    exit 1
  fi
fi

# Optional Origin sync — fetch only, never merge, never abort launch.
if [ -z "${ATOM_SKIP_SYNC:-}" ] && [ -d .git ] && command -v git >/dev/null 2>&1; then
  SYNC_BRANCH="${ATOM_SYNC_BRANCH:-main}"
  atom_log "[ATOM] Checking Origin for updates (origin/$SYNC_BRANCH)..."
  if git fetch --quiet origin "$SYNC_BRANCH" >>"$ATOM_LOG" 2>&1; then
    LOCAL_REF="$(git rev-parse HEAD 2>/dev/null || true)"
    REMOTE_REF="$(git rev-parse "origin/$SYNC_BRANCH" 2>/dev/null || true)"
    if [ -n "$REMOTE_REF" ] && [ "$LOCAL_REF" != "$REMOTE_REF" ]; then
      atom_log "[ATOM] origin/$SYNC_BRANCH has new commits. Start as usual; pull when you want them."
    else
      atom_log "[ATOM] Already up to date."
    fi
  else
    atom_log "[ATOM] Offline or Origin unreachable — starting with current version."
  fi
fi

if [ -n "${ATOM_CLEAN_PORTS:-}" ]; then
  atom_clean_ports
fi

# Voice (optional) — never fail launch if uvicorn/python is missing.
VOICE_DIR="$ROOT/voice-server"
if [ -f "$VOICE_DIR/app.py" ] && ! atom_port_in_use 8765; then
  if [ -x "$VOICE_DIR/.venv/bin/uvicorn" ]; then
    (cd "$VOICE_DIR" && nohup .venv/bin/uvicorn app:app --host 127.0.0.1 --port 8765 >>"$ROOT/voice-server.log" 2>&1 &)
    atom_log "[ATOM] Voice server on http://localhost:8765"
  elif [ -x "$VOICE_DIR/venv/bin/uvicorn" ]; then
    (cd "$VOICE_DIR" && nohup venv/bin/uvicorn app:app --host 127.0.0.1 --port 8765 >>"$ROOT/voice-server.log" 2>&1 &)
    atom_log "[ATOM] Voice server on http://localhost:8765"
  else
    atom_log "[ATOM] Voice server skipped (no venv). Run ./setup.sh to enable mic input."
  fi
fi

# Search proxy (optional)
if [ -f "$ROOT/scripts/search-proxy.mjs" ] && ! atom_port_in_use 5174; then
  nohup node "$ROOT/scripts/search-proxy.mjs" >>"$ROOT/search-proxy.log" 2>&1 &
  atom_log "[ATOM] Search proxy on http://localhost:5174"
fi

# llama-server is OPTIONAL. The user typically uses LM Studio on :1234.
# Never invoke a missing binary (that was the red-text flash + closed window).
if [ "${ATOM_START_LLAMA:-auto}" != "0" ] && ! atom_port_in_use 8080; then
  if LLAMA_BIN="$(atom_resolve_llama_bin)"; then
    atom_log "[ATOM] Starting llama-server ($LLAMA_BIN) on :8080 (optional)..."
    nohup "$LLAMA_BIN" --port 8080 --host 127.0.0.1 >>"$ROOT/llama-server.log" 2>&1 &
  else
    atom_log "[ATOM] No llama-server on PATH — skipping (LM Studio / cloud APIs still work)."
  fi
elif atom_port_in_use 8080; then
  atom_log "[ATOM] Port 8080 already in use — leaving it alone."
fi

PORT="$(atom_pick_ui_port)"
UI_URL="http://localhost:${PORT}/"

if atom_port_in_use "$PORT"; then
  if atom_http_ok "$UI_URL"; then
    atom_log "[ATOM] UI already running at $UI_URL — opening browser."
    atom_open_browser "$UI_URL" || true
    if [ -t 0 ] && [ -z "${ATOM_NO_HOLD:-}" ]; then
      echo "ATOM is already running. This window can be closed."
      read -r _ || true
    fi
    exit 0
  fi
  atom_log "[ATOM] ERROR: port ${PORT} is in use but is not serving ATOM."
  atom_log "[ATOM] Stop the other process, or run: ATOM_CLEAN_PORTS=1 ./start-atom.sh"
  atom_log "[ATOM] Or pick another port: ATOM_UI_PORT=5175 ./start-atom.sh"
  hold
  exit 1
fi

atom_log "[ATOM] Starting UI on ${UI_URL}"
atom_open_browser_when_ready "$PORT" &
BROWSER_PID=$!

cleanup() {
  kill "$BROWSER_PID" 2>/dev/null || true
}
trap 'echo ""; atom_log "[ATOM] Shutting down..."; cleanup; exit 0' INT TERM

echo ""
echo "Leave this window open. Press Ctrl+C to stop."
echo "UI URL: ${UI_URL}"
echo ""

# Foreground Vite keeps the desktop-launcher terminal alive.
# Do not exec — if Vite exits we hold the window so the red error stays readable.
set +e
npm run dev -- --port "$PORT" --host localhost
VITE_STATUS=$?
set +e

if [ "$VITE_STATUS" -ne 0 ]; then
  atom_log "[ATOM] ERROR: Vite/npm exited with status $VITE_STATUS. Last 40 lines of $ATOM_LOG:"
  tail -n 40 "$ATOM_LOG" 2>/dev/null || true
  hold
  exit "$VITE_STATUS"
fi
