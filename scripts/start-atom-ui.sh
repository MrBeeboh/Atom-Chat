#!/usr/bin/env bash
# ATOM Chat UI only. Opens in the desktop terminal and serves port 5175.
# Does not start, stop, or signal llama, and does not touch ports 8080, 8081, or 18081.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

echo "[ATOM] UI only — port 5175. Not touching llama or ports 8080, 8081, 18081."

port_listening() {
  ss -H -ltn "sport = :$1" 2>/dev/null | grep -q .
}

if port_listening 5174; then
  echo "[ATOM] Search proxy already listening on 5174 — leaving it."
elif [ -f scripts/search-proxy.mjs ]; then
  echo "[ATOM] Starting search proxy on 5174..."
  nohup node scripts/search-proxy.mjs >> "$ROOT/search-proxy.log" 2>&1 &
  disown || true
fi

if port_listening 8765; then
  echo "[ATOM] Voice server already listening on 8765 — leaving it."
elif [ -f "$ROOT/voice-server/app.py" ]; then
  if [ -x "$ROOT/voice-server/.venv/bin/python" ]; then
    VOICE_PY="$ROOT/voice-server/.venv/bin/python"
  else
    VOICE_PY="python3"
  fi
  echo "[ATOM] Starting voice server on 8765..."
  ( cd "$ROOT/voice-server" && nohup "$VOICE_PY" -m uvicorn app:app --host 0.0.0.0 --port 8765 >> "$ROOT/voice-server.log" 2>&1 & )
fi

atom_ui_up() {
  curl -sS --max-time 2 "http://127.0.0.1:5175/" 2>/dev/null | grep -q '<title>ATOM</title>'
}

if port_listening 5175; then
  if atom_ui_up; then
    echo "[ATOM] Already running at http://127.0.0.1:5175/ — not restarting."
    nohup xdg-open "http://127.0.0.1:5175/" >/dev/null 2>&1 &
    disown || true
  else
    echo "[ATOM] Port 5175 is in use, but it is not the ATOM page. Not killing it."
  fi
  echo "[ATOM] Close this window when you are done, or press Enter."
  if [ -t 0 ]; then
    read -r _
  else
    sleep 3600
  fi
  exit 0
fi

echo "[ATOM] Starting Vite on http://127.0.0.1:5175/ ..."
npm run dev -- --port 5175 --strictPort &
UI_PID=$!

ui_ok=0
for _ in $(seq 1 40); do
  if atom_ui_up; then
    ui_ok=1
    echo "[ATOM] UI is up: http://127.0.0.1:5175/"
    nohup xdg-open "http://127.0.0.1:5175/" >/dev/null 2>&1 &
    disown || true
    break
  fi
  if ! kill -0 "$UI_PID" 2>/dev/null; then
    echo "[ATOM] ERROR: Vite exited before the UI came up." >&2
    break
  fi
  sleep 0.5
done

if [ "$ui_ok" != 1 ]; then
  echo "[ATOM] UI did not start on http://127.0.0.1:5175/" >&2
  if [ -t 0 ]; then
    read -r -p "[ATOM] Press Enter to close this window..." _
  fi
  exit 1
fi

trap 'kill "$UI_PID" 2>/dev/null; exit 0' INT TERM
wait "$UI_PID" || true
