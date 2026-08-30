#!/bin/bash
# ATOM UI Launcher - run from lm-studio-ui-updated (this folder has working voice)
# Starts: search proxy (5174) -> voice server (8765) -> Vite (5173)

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR" || exit 1
# shellcheck source=scripts/atom-launcher-lib.sh
. "$PROJECT_DIR/scripts/atom-launcher-lib.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}Starting ATOM UI...${NC}"

# --- Auto-sync from GitHub on launch (set ATOM_SKIP_SYNC=1 to disable) -------
# Never blocks launch: offline, local edits, or a diverged branch all fall
# through to starting the current version.
if [ -z "${ATOM_SKIP_SYNC:-}" ] && [ -d .git ] && command -v git >/dev/null 2>&1; then
    SYNC_BRANCH="${ATOM_SYNC_BRANCH:-main}"
    echo -e "${GREEN}Checking GitHub for updates (origin/$SYNC_BRANCH)...${NC}"
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
        echo -e "${YELLOW}Offline or GitHub unreachable — starting with current version.${NC}"
    fi
fi

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
ATOM_UI_PORT="${ATOM_UI_PORT:-5173}"
UI_URL="http://localhost:${ATOM_UI_PORT}/"
echo -e "${GREEN}Starting Vite (${ATOM_UI_PORT})...${NC}"
npm run dev -- --port "$ATOM_UI_PORT" --strictPort &
VITE_PID=$!

if atom_wait_for_http "$UI_URL" 20 1; then
    atom_launch_url "$ATOM_UI_PORT"
else
    if ! kill -0 "$VITE_PID" 2>/dev/null; then
        echo -e "${RED}ERROR: Vite did not start on ${ATOM_UI_PORT}.${NC}"
        kill $SEARCH_PID 2>/dev/null
        exit 1
    fi
    echo -e "${YELLOW}WARNING: UI is slow to start. Open manually: ${UI_URL}${NC}"
    atom_launch_url "$ATOM_UI_PORT" || true
fi

echo -e "Press Ctrl+C to stop"
trap 'echo -e "\n${YELLOW}Shutting down...${NC}"; kill $VITE_PID $SEARCH_PID $VOICE_PID 2>/dev/null; exit 0' INT TERM
wait "$VITE_PID"
