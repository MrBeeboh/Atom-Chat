#!/bin/bash
echo "=== ATOM LM Studio UI ==="

cd "$(dirname "$0")" || exit 1

# Start Frontend + auto open browser
echo "🚀 Starting UI..."
npm run dev &
FRONTEND_PID=$!

sleep 8
xdg-open http://localhost:5173 &

# Start Voice Server
echo "🎤 Starting Voice Server..."
cd voice-server
source venv/bin/activate
uvicorn app:app --host 0.0.0.0 --port 8765 &
VOICE_PID=$!
cd ..

echo ""
echo "✅ UI is opening automatically"
echo "Press Ctrl+C to stop"
echo ""

trap 'kill $FRONTEND_PID $VOICE_PID 2>/dev/null; exit 0' INT
wait
