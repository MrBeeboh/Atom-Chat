#!/bin/bash
# ATOM UI Launcher - run from lm-studio-ui-updated (this folder has working voice)
# Starts: search proxy (5174) -> voice server (8765) -> Vite (5173)

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR" || exit 1

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}Starting ATOM UI...${NC}"

check_port() {
    if lsof -Pi :"$1" -sTCP:LISTEN -t >/dev/null 2>&1; then return 1; else return 0; fi
}

cleanup() {
    echo -e "${YELLOW}Cleaning up...${NC}"
    pkill -f "node.*search-proxy.mjs" 2>/dev/null
    pkill -f "vite" 2>/dev/null
    pkill -f "python.*voice-server" 2>/dev/null
    for port in 5173 5174 8765; do
        pid=$(lsof -ti :"$port" 2>/dev/null)
        [ -n "$pid" ] && kill -9 $pid 2>/dev/null
    done
    sleep 2
}
cleanup

# Search proxy
if check_port 5174; then
    echo -e "${GREEN}Starting Search Proxy (5174)...${NC}"
    node scripts/search-proxy.mjs &
    SEARCH_PID=$!
    sleep 2
    if ! kill -0 $SEARCH_PID 2>/dev/null; then
        echo -e "${RED}ERROR: Search proxy failed. Check: node --version${NC}"
        exit 1
    fi
fi

# Voice server (this folder has voice-server/venv)
if [ -d "voice-server" ] && [ -f "voice-server/app.py" ] && check_port 8765; then
    echo -e "${GREEN}Starting Voice Server (8765)...${NC}"
    ( cd voice-server && [ -f venv/bin/activate ] && . venv/bin/activate; command -v uvicorn >/dev/null && uvicorn app:app --host 0.0.0.0 --port 8765 ) &
    VOICE_PID=$!
    sleep 2
fi

# Vite
echo -e "${GREEN}Starting Vite (5173)...${NC}"
npm run dev &
VITE_PID=$!
# Wait for Vite to respond (lsof can miss it on some systems)
for i in 1 2 3 4 5 6 7 8 9 10; do
    sleep 1
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/ 2>/dev/null | grep -q 200; then
        break
    fi
    if [ "$i" -eq 10 ]; then
        echo -e "${RED}ERROR: Vite did not respond on 5173 after 10s${NC}"
        kill $SEARCH_PID 2>/dev/null
        exit 1
    fi
done

echo ""
echo -e "${GREEN}✓ ATOM UI running: http://localhost:5173${NC}"
xdg-open http://localhost:5173 2>/dev/null &
echo -e "Press Ctrl+C to stop"
trap 'echo -e "\n${YELLOW}Shutting down...${NC}"; kill $VITE_PID $SEARCH_PID $VOICE_PID 2>/dev/null; exit 0' INT TERM
wait
