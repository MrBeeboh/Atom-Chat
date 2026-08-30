#!/bin/bash
echo "=== ATOM (llama.cpp backend) ==="

cd "$(dirname "$0")" || exit 1
# shellcheck source=scripts/atom-launcher-lib.sh
. "$(pwd)/scripts/atom-launcher-lib.sh"

ATOM_UI_PORT="${ATOM_UI_PORT:-5173}"
UI_URL="http://localhost:${ATOM_UI_PORT}/"

# Start Frontend + auto open browser
echo "🚀 Starting UI..."
npm run dev -- --port "$ATOM_UI_PORT" &
FRONTEND_PID=$!

if atom_wait_for_http "$UI_URL" 20 0.5; then
  atom_launch_url "$ATOM_UI_PORT"
else
  echo "WARNING: UI slow to start. Open manually: $UI_URL"
fi

# Start Voice Server
echo "🎤 Starting Voice Server..."
cd voice-server
if [ -f venv/bin/activate ]; then . venv/bin/activate; fi
uvicorn app:app --host 0.0.0.0 --port 8765 &
VOICE_PID=$!
cd ..

echo ""
echo "Press Ctrl+C to stop"
echo ""

trap 'kill $FRONTEND_PID $VOICE_PID 2>/dev/null; exit 0' INT
wait "$FRONTEND_PID"
