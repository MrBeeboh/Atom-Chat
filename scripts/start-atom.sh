#!/usr/bin/env bash
# ATOM - llama.cpp launcher (one double-click)

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Intel Arc / Data Center GPU: use a llama.cpp build with SYCL (GGML_SYCL), not a CUDA-only binary.
# Set LLAMA_SERVER_BIN to the full path of your SYCL llama-server if it is not first on PATH.
resolve_llama_server() {
  if [ -n "${LLAMA_SERVER_BIN:-}" ]; then
    if command -v "${LLAMA_SERVER_BIN}" >/dev/null 2>&1; then
      command -v "${LLAMA_SERVER_BIN}"
      return
    fi
    if [ -x "${LLAMA_SERVER_BIN}" ]; then
      echo "${LLAMA_SERVER_BIN}"
      return
    fi
    echo "[ATOM] LLAMA_SERVER_BIN is set but not executable: ${LLAMA_SERVER_BIN}" >&2
  fi
  if command -v llama-server-sycl >/dev/null 2>&1; then
    command -v llama-server-sycl
    return
  fi
  command -v llama-server 2>/dev/null || echo llama-server
}

LLAMA_BIN="$(resolve_llama_server)"

echo "[ATOM] Starting..."
echo "[ATOM] llama-server binary: ${LLAMA_BIN}"
if ! echo "${LLAMA_BIN}" | grep -qi sycl; then
  echo "[ATOM] Tip: On Intel Arc, use a SYCL-enabled llama.cpp build for GPU speed (see TROUBLESHOOTING.md). Set LLAMA_SERVER_BIN if needed."
fi

# Check if llama-server is already running on 8080
if curl -s --max-time 2 http://localhost:8080/v1/models > /dev/null 2>&1; then
    echo "[ATOM] llama-server already running on port 8080"
else
    echo "[ATOM] Starting llama-server..."
    
    # Try to find a model
    MODEL=""
    for dir in "$HOME/.lmstudio/models" "$HOME/models" "$HOME/.cache/llama.cpp" "$HOME/Downloads"; do
        if [ -d "$dir" ]; then
            MODEL=$(find "$dir" -maxdepth 4 -name "*.gguf" 2>/dev/null | head -1)
            [ -n "$MODEL" ] && break
        fi
    done

    if [ -n "$MODEL" ] && [ -f "$MODEL" ]; then
        echo "[ATOM] Using model: $MODEL"
        nohup "$LLAMA_BIN" -m "$MODEL" --port 8080 --n-gpu-layers 99 --host 0.0.0.0 >> llama-server.log 2>&1 &
        disown || true
        
        # Wait for server
        for i in {1..30}; do
            if curl -s --max-time 1 http://localhost:8080/v1/models > /dev/null 2>&1; then
                echo "[ATOM] llama-server ready"
                break
            fi
            sleep 1
        done
    else
        echo "[ATOM] No .gguf model found under ~/.lmstudio/models, ~/models, etc."
    fi
fi

# Start voice server if present (prefer project venv so deps match setup.sh)
if [ -f voice-server/app.py ]; then
    if [ -x voice-server/.venv/bin/python ]; then
        VOICE_PY="voice-server/.venv/bin/python"
    else
        VOICE_PY="python3"
    fi
    (cd voice-server && nohup "$VOICE_PY" -m uvicorn app:app --host 0.0.0.0 --port 8765 >> ../voice-server.log 2>&1 &)
fi

# Start search proxy
if [ -f scripts/search-proxy.mjs ]; then
    nohup node scripts/search-proxy.mjs >> search-proxy.log 2>&1 &
fi

# UI port: keep 5175 for this launcher so localStorage (API keys, backend URL) stays on the same
# origin as before. Port 5173 vs 5175 are different sites to the browser — keys do not carry over.
ATOM_UI_PORT="${ATOM_UI_PORT:-5175}"
npm run dev -- --port "$ATOM_UI_PORT" --strictPort &
UI_PID=$!

# Open browser once dev server responds (use localhost, not 127.0.0.1, so origin matches bookmarks)
for i in $(seq 1 40); do
    if curl -s --max-time 1 "http://localhost:${ATOM_UI_PORT}/" >/dev/null 2>&1; then
        (sleep 1; xdg-open "http://localhost:${ATOM_UI_PORT}/" 2>/dev/null) &
        break
    fi
    sleep 0.5
done

trap 'kill $UI_PID 2>/dev/null; exit 0' INT TERM
wait $UI_PID
