#!/usr/bin/env bash
# ATOM - llama.cpp launcher (one double-click)

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Intel oneAPI on PATH (SYCL runtime). Same shell is inherited by llama-server below.
if [ -z "${ATOM_SKIP_ONEAPI:-}" ] && [ -z "${ONEAPI_ROOT:-}" ]; then
  for _setvars in /opt/intel/oneapi/setvars.sh "$HOME/intel/oneapi/setvars.sh"; do
    if [ -f "$_setvars" ]; then
      echo "[ATOM] oneAPI: sourcing ${_setvars}"
      set +e
      # shellcheck source=/dev/null
      . "$_setvars" >/dev/null 2>&1
      set -e
      break
    fi
  done
fi

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

# Pick smallest .gguf under these trees (loads faster; avoids auto-picking a 30B+ first from sort order).
pick_smallest_gguf() {
    local line
    line="$(
        for _dir in "$HOME/.lmstudio/models" "$HOME/models" "$HOME/.cache/llama.cpp" "$HOME/Downloads"; do
            [ -d "$_dir" ] || continue
            find "$_dir" -maxdepth 5 -name '*.gguf' -type f -printf '%s\t%p\n' 2>/dev/null
        done | sort -n | head -1
    )"
    if [ -n "$line" ]; then
        printf '%s' "$line" | cut -f2-
    fi
}

llama_ready() {
    curl -sS --max-time 3 "http://127.0.0.1:8080/v1/models" >/dev/null 2>&1 \
        || curl -sS --max-time 3 "http://127.0.0.1:8080/models" >/dev/null 2>&1
}

# Check if llama-server is already running on 8080
if llama_ready; then
    echo "[ATOM] llama-server already running on port 8080"
else
    echo "[ATOM] Starting llama-server..."

    ATOM_MODELS_DIR="${ATOM_MODELS_DIR:-$HOME/.lmstudio/models}"
    # Prefer router mode: no GGUF in VRAM until the app calls /models/load (Arena loads one at a time).
    ROUTER=0
    if [ -z "${MODEL:-}" ] && [ -z "${GGUF_PATH:-}" ] && [ -d "$ATOM_MODELS_DIR" ] && "${LLAMA_BIN}" --help 2>&1 | grep -qE 'models-dir'; then
        ROUTER=1
    fi
    ROUTER_EXTRA=()
    if [ "$ROUTER" = 1 ] && "${LLAMA_BIN}" --help 2>&1 | grep -qE 'no-models-autoload'; then
        ROUTER_EXTRA=(--no-models-autoload)
    fi

    if [ -n "${MODEL:-}" ] || [ -n "${GGUF_PATH:-}" ]; then
        MODEL="${MODEL:-$GGUF_PATH}"
    elif [ "$ROUTER" = 1 ]; then
        MODEL=""
    else
        MODEL="$(pick_smallest_gguf)"
    fi

    if [ "$ROUTER" = 1 ]; then
        echo "[ATOM] Router: --models-dir $ATOM_MODELS_DIR --models-max 1 --no-models-autoload (nothing preloaded into VRAM)"
        : >>"$ROOT/llama-server.log"
        nohup "$LLAMA_BIN" --models-dir "$ATOM_MODELS_DIR" --models-max 1 "${ROUTER_EXTRA[@]}" --n-gpu-layers 99 --port 8080 --host 0.0.0.0 >>"$ROOT/llama-server.log" 2>&1 &
        LLAMA_PID=$!
        disown || true
    elif [ -n "$MODEL" ] && [ -f "$MODEL" ]; then
        echo "[ATOM] Using model (explicit or smallest GGUF): $MODEL"
        : >>"$ROOT/llama-server.log"
        nohup "$LLAMA_BIN" -m "$MODEL" --port 8080 --n-gpu-layers 99 --host 0.0.0.0 >>"$ROOT/llama-server.log" 2>&1 &
        LLAMA_PID=$!
        disown || true
    else
        echo "[ATOM] No .gguf found for legacy -m mode and router unavailable (missing --models-dir in this binary or empty $ATOM_MODELS_DIR)."
        LLAMA_PID=""
    fi

    if [ -n "${LLAMA_PID:-}" ]; then
        LM_WAIT_ATTEMPTS="${LM_WAIT_ATTEMPTS:-120}"
        LM_WAIT_SLEEP="${LM_WAIT_SLEEP:-1}"
        echo "[ATOM] Waiting up to $((LM_WAIT_ATTEMPTS * LM_WAIT_SLEEP))s for llama HTTP on :8080 ..."
        llama_ok=0
        for ((i = 1; i <= LM_WAIT_ATTEMPTS; i++)); do
            if ! kill -0 "$LLAMA_PID" 2>/dev/null; then
                echo "[ATOM] ERROR: llama-server process exited (PID $LLAMA_PID). Last lines of llama-server.log:"
                tail -n 60 "$ROOT/llama-server.log" 2>/dev/null || true
                break
            fi
            if llama_ready; then
                echo "[ATOM] llama-server ready (${i}x${LM_WAIT_SLEEP}s)"
                llama_ok=1
                break
            fi
            sleep "$LM_WAIT_SLEEP"
        done
        if [ "$llama_ok" != 1 ]; then
            if kill -0 "$LLAMA_PID" 2>/dev/null; then
                echo "[ATOM] WARNING: llama-server not answering on :8080 yet — UI will start; retry when the server is ready."
            fi
        fi
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
