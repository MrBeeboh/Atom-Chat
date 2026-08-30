#!/bin/bash
# ATOM UI launcher for Linux (Mint, etc.)
# Starts: search proxy (5174) -> voice server (8765) -> Vite (5173) -> opens browser

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR" || exit 1
# shellcheck source=scripts/atom-launcher-lib.sh
. "$PROJECT_DIR/scripts/atom-launcher-lib.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}Starting ATOM UI...${NC}"

# --- Auto-sync from Origin on launch (set ATOM_SKIP_SYNC=1 to disable) -------
if [ -z "${ATOM_SKIP_SYNC:-}" ] && [ -d .git ] && command -v git >/dev/null 2>&1; then
    SYNC_BRANCH="${ATOM_SYNC_BRANCH:-main}"
    echo -e "${GREEN}Checking Origin for updates (origin/$SYNC_BRANCH)...${NC}"
    if git fetch --quiet origin "$SYNC_BRANCH" 2>/dev/null; then
        LOCAL_REF="$(git rev-parse HEAD 2>/dev/null || true)"
        REMOTE_REF="$(git rev-parse "origin/$SYNC_BRANCH" 2>/dev/null || true)"
        CUR_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
        if [ -z "$REMOTE_REF" ] || [ "$LOCAL_REF" = "$REMOTE_REF" ]; then
            echo "Already up to date."
        elif [ "$CUR_BRANCH" != "$SYNC_BRANCH" ]; then
            echo -e "${YELLOW}On branch '$CUR_BRANCH' (not '$SYNC_BRANCH') — skipping auto-sync.${NC}"
        elif [ -n "$(git status --porcelain 2>/dev/null)" ]; then
            echo -e "${YELLOW}Local changes detected — skipping auto-sync so nothing is overwritten.${NC}"
        else
            OLD_LOCK="$(git rev-parse HEAD:package-lock.json 2>/dev/null || true)"
            if git merge --ff-only "origin/$SYNC_BRANCH" >/dev/null 2>&1; then
                echo -e "${GREEN}Updated to $(git rev-parse --short HEAD).${NC}"
                NEW_LOCK="$(git rev-parse HEAD:package-lock.json 2>/dev/null || true)"
                if [ "$OLD_LOCK" != "$NEW_LOCK" ]; then
                    echo "Dependencies changed — running npm install..."
                    npm install --no-audit --no-fund --legacy-peer-deps \
                        || echo -e "${YELLOW}WARNING: npm install failed; continuing with existing node_modules.${NC}"
                fi
            else
                echo -e "${YELLOW}Local history differs from origin/$SYNC_BRANCH — skipping auto-sync.${NC}"
            fi
        fi
    else
        echo -e "${YELLOW}Offline or Origin unreachable — starting with current version.${NC}"
    fi
fi

check_port() {
    if command -v lsof >/dev/null 2>&1; then
        lsof -Pi :"$1" -sTCP:LISTEN -t >/dev/null 2>&1 && return 1
    elif command -v ss >/dev/null 2>&1; then
        ss -ltn "( sport = :$1 )" 2>/dev/null | grep -q LISTEN && return 1
    fi
    return 0
}

if [ -n "${ATOM_CLEAN_PORTS:-}" ]; then
    echo -e "${YELLOW}Clearing stuck ATOM ports (ATOM_CLEAN_PORTS=1)...${NC}"
    pkill -f "node.*search-proxy.mjs" 2>/dev/null || true
    pkill -f "vite" 2>/dev/null || true
    pkill -f "python.*voice-server" 2>/dev/null || true
    for port in 5173 5174 8765; do
        if command -v lsof >/dev/null 2>&1; then
            pid=$(lsof -ti :"$port" 2>/dev/null || true)
            [ -n "$pid" ] && kill -9 $pid 2>/dev/null || true
        fi
    done
    sleep 1
fi

# Search proxy
if check_port 5174; then
    echo -e "${GREEN}Starting search proxy (5174)...${NC}"
    nohup node scripts/search-proxy.mjs >>search-proxy.log 2>&1 &
    SEARCH_PID=$!
    sleep 1
    if ! kill -0 "$SEARCH_PID" 2>/dev/null; then
        echo -e "${RED}ERROR: Search proxy failed. Check: node --version${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}Port 5174 already in use — reusing existing search proxy.${NC}"
    SEARCH_PID=""
fi

# Voice server
if [ -d "voice-server" ] && [ -f "voice-server/app.py" ] && check_port 8765; then
    echo -e "${GREEN}Starting voice server (8765)...${NC}"
    if [ -x voice-server/.venv/bin/python ]; then
        VOICE_PY="voice-server/.venv/bin/python"
    elif [ -x voice-server/venv/bin/python ]; then
        VOICE_PY="voice-server/venv/bin/python"
    else
        VOICE_PY="python3"
    fi
    nohup bash -c "cd \"$PROJECT_DIR/voice-server\" && \"$VOICE_PY\" -m uvicorn app:app --host 0.0.0.0 --port 8765" >>"$PROJECT_DIR/voice-server.log" 2>&1 &
    VOICE_PID=$!
    sleep 1
else
    VOICE_PID=""
fi

ATOM_UI_PORT="${ATOM_UI_PORT:-5173}"
UI_URL="http://localhost:${ATOM_UI_PORT}/"

if atom_port_in_use "$ATOM_UI_PORT"; then
    echo -e "${RED}ERROR: port ${ATOM_UI_PORT} is already in use.${NC}"
    echo -e "${YELLOW}Stop the other Vite window, run: ATOM_CLEAN_PORTS=1 ./start-atom.sh${NC}"
    echo -e "${YELLOW}Or use another port: ATOM_UI_PORT=5175 ./start-atom.sh${NC}"
    exit 1
fi

echo -e "${GREEN}Starting Vite (${ATOM_UI_PORT})...${NC}"
atom_open_browser_when_ready "$ATOM_UI_PORT" &

cleanup_children() {
    echo -e "\n${YELLOW}Shutting down ATOM...${NC}"
    kill "$SEARCH_PID" "$VOICE_PID" 2>/dev/null || true
}
trap cleanup_children INT TERM

echo -e "${GREEN}Press Ctrl+C in this window to stop ATOM.${NC}"
echo -e "${GREEN}UI URL: ${UI_URL}${NC}"
echo ""

# Foreground Vite keeps this terminal (and desktop launcher) alive until you stop it.
npm run dev -- --port "$ATOM_UI_PORT" --strictPort --host localhost
