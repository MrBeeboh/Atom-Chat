#!/usr/bin/env bash
# Start ATOM (LM Studio UI): voice server (if present) + dev server + open browser.
# Same as running START-VOICE-SERVER.bat (project folder) then the UI. Uses port 5175.

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Start voice server in background (Linux equivalent of START-VOICE-SERVER.bat in project folder).
VOICE_DIR="$ROOT/voice-server"
if [ -d "$VOICE_DIR" ] && [ -f "$VOICE_DIR/app.py" ]; then
  if [ ! -x "$VOICE_DIR/.venv/bin/uvicorn" ]; then
    echo "[ATOM] First-time voice server setup (creating venv, installing deps)..."
    (cd "$VOICE_DIR" && python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt) || {
      echo "[ATOM] Voice server setup failed. Run: cd voice-server && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
      echo "[ATOM] See VOICE-SETUP.md"
    }
  fi
  if [ -x "$VOICE_DIR/.venv/bin/uvicorn" ]; then
    (cd "$VOICE_DIR" && nohup .venv/bin/uvicorn app:app --host 0.0.0.0 --port 8765) >> "$ROOT/voice-server.log" 2>&1 &
    disown 2>/dev/null || true
    echo "[ATOM] Voice server starting (http://localhost:8765). Log: $ROOT/voice-server.log"
  fi
fi

PORT=5175
# Open browser after the dev server is up
(sleep 3 && xdg-open "http://localhost:${PORT}") &

exec npm run dev -- --port "$PORT"
