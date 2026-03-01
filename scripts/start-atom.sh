#!/usr/bin/env bash
# Start ATOM (LM Studio UI): LM Studio server + voice server + search proxy + dev server + open browser.

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Start LM Studio API server (headless, port 1234)
if command -v lms &> /dev/null; then
  echo "[ATOM] Starting LM Studio API server..."
  lms server start 2>/dev/null || true
  sleep 2
  # Verify it came up
  if curl -s http://localhost:1234/v1/models > /dev/null 2>&1; then
    echo "[ATOM] LM Studio API server running (http://localhost:1234)"
  else
    echo "[ATOM] WARNING: LM Studio API server did not respond on port 1234. Open LM Studio and enable the server in the Developer tab."
  fi
else
  echo "[ATOM] WARNING: 'lms' CLI not found. Open LM Studio manually and start the server in the Developer tab."
fi

# Start voice server in background
VOICE_DIR="$ROOT/voice-server"
if [ -d "$VOICE_DIR" ] && [ -f "$VOICE_DIR/app.py" ]; then
  if [ ! -x "$VOICE_DIR/.venv/bin/uvicorn" ]; then
    echo "[ATOM] First-time voice server setup (creating venv, installing deps)..."
    (cd "$VOICE_DIR" && python3 -m venv .venv && .venv/bin/python -m pip install -q -r requirements.txt) || {
      echo "[ATOM] Voice server setup failed. Run: cd voice-server && python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt"
      echo "[ATOM] See VOICE-SETUP.md"
    }
  fi
  if [ -x "$VOICE_DIR/.venv/bin/uvicorn" ]; then
    (cd "$VOICE_DIR" && nohup .venv/bin/uvicorn app:app --host 0.0.0.0 --port 8765) >> "$ROOT/voice-server.log" 2>&1 &
    disown 2>/dev/null || true
    echo "[ATOM] Voice server starting (http://localhost:8765). Log: $ROOT/voice-server.log"
  fi
fi

# Start web search proxy in background
SEARCH_PROXY="$ROOT/scripts/search-proxy.mjs"
if [ -f "$SEARCH_PROXY" ]; then
  nohup node "$SEARCH_PROXY" >> "$ROOT/search-proxy.log" 2>&1 &
  disown 2>/dev/null || true
  echo "[ATOM] Search proxy starting (http://localhost:5174). Log: $ROOT/search-proxy.log"
fi

PORT=5175
# Open browser after the dev server is up
(sleep 3 && xdg-open "http://localhost:${PORT}") &

exec npm run dev -- --port "$PORT"
