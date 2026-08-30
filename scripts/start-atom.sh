#!/usr/bin/env bash
# Atom Chat launcher (Linux Mint desktop + npm run start)
# Starts voice (8765), search proxy (5174), UI (5175), opens browser.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# --- Auto-sync from Origin (git remote named "origin") -----------------------
if [ -z "${ATOM_SKIP_SYNC:-}" ] && [ -d .git ] && command -v git >/dev/null 2>&1; then
  SYNC_BRANCH="${ATOM_SYNC_BRANCH:-main}"
  echo "[ATOM] Checking Origin for updates (origin/$SYNC_BRANCH)..."
  if git fetch --quiet origin "$SYNC_BRANCH" 2>/dev/null; then
    LOCAL_REF="$(git rev-parse HEAD 2>/dev/null || true)"
    REMOTE_REF="$(git rev-parse "origin/$SYNC_BRANCH" 2>/dev/null || true)"
    CUR_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    if [ -n "$REMOTE_REF" ] && [ "$LOCAL_REF" != "$REMOTE_REF" ] && [ "$CUR_BRANCH" = "$SYNC_BRANCH" ] && [ -z "$(git status --porcelain 2>/dev/null)" ]; then
      OLD_LOCK="$(git rev-parse HEAD:package-lock.json 2>/dev/null || true)"
      if git merge --ff-only "origin/$SYNC_BRANCH" >/dev/null 2>&1; then
        echo "[ATOM] Updated to $(git rev-parse --short HEAD)."
        NEW_LOCK="$(git rev-parse HEAD:package-lock.json 2>/dev/null || true)"
        if [ "$OLD_LOCK" != "$NEW_LOCK" ]; then
          echo "[ATOM] Dependencies changed — running npm install..."
          npm install --no-audit --no-fund --legacy-peer-deps || true
        fi
      fi
    fi
  fi
fi

# Voice server
VOICE_DIR="$ROOT/voice-server"
if [ -d "$VOICE_DIR" ] && [ -f "$VOICE_DIR/app.py" ]; then
  if [ ! -x "$VOICE_DIR/.venv/bin/uvicorn" ]; then
    echo "[ATOM] First-time voice server setup..."
    (cd "$VOICE_DIR" && python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt) || true
  fi
  if [ -x "$VOICE_DIR/.venv/bin/uvicorn" ]; then
    (cd "$VOICE_DIR" && nohup .venv/bin/uvicorn app:app --host 0.0.0.0 --port 8765 >> "$ROOT/voice-server.log" 2>&1 &)
    disown 2>/dev/null || true
    echo "[ATOM] Voice server on http://localhost:8765"
  fi
fi

# Search proxy
if [ -f "$ROOT/scripts/search-proxy.mjs" ]; then
  nohup node "$ROOT/scripts/search-proxy.mjs" >> "$ROOT/search-proxy.log" 2>&1 &
  disown 2>/dev/null || true
  echo "[ATOM] Search proxy on http://localhost:5174"
fi

PORT="${ATOM_UI_PORT:-5175}"
echo "[ATOM] Starting UI on http://localhost:${PORT}/"
(sleep 3 && xdg-open "http://localhost:${PORT}/") &

exec npm run dev -- --port "$PORT"
