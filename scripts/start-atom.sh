#!/usr/bin/env bash
# ATOM - llama.cpp launcher (one double-click)

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck source=scripts/llama-gpu-common.sh
. "$ROOT/scripts/llama-gpu-common.sh"

# --- Auto-sync from GitHub on launch (set ATOM_SKIP_SYNC=1 to disable) -------
# Pulls the latest release branch before starting so the desktop app never
# drifts behind the repo. Never blocks launch: offline, local edits, or a
# diverged branch all fall through to starting the current version.
if [ -z "${ATOM_SKIP_SYNC:-}" ] && [ -d .git ] && command -v git >/dev/null 2>&1; then
    SYNC_BRANCH="${ATOM_SYNC_BRANCH:-main}"
    echo "[ATOM] Checking GitHub for updates (origin/$SYNC_BRANCH)..."
    if git fetch --quiet origin "$SYNC_BRANCH" 2>/dev/null; then
        LOCAL_REF="$(git rev-parse HEAD 2>/dev/null || true)"
        REMOTE_REF="$(git rev-parse "origin/$SYNC_BRANCH" 2>/dev/null || true)"
        CUR_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
        if [ -z "$REMOTE_REF" ] || [ "$LOCAL_REF" = "$REMOTE_REF" ]; then
            echo "[ATOM] Already up to date."
        elif [ "$CUR_BRANCH" != "$SYNC_BRANCH" ]; then
            echo "[ATOM] On branch '$CUR_BRANCH' (not '$SYNC_BRANCH') — skipping auto-sync."
        elif [ -n "$(git status --porcelain 2>/dev/null)" ]; then
            echo "[ATOM] Local changes detected — skipping auto-sync so nothing is overwritten."
            echo "[ATOM] (commit or stash them, or set ATOM_SKIP_SYNC=1 to silence this check)"
        else
            OLD_LOCK="$(git rev-parse HEAD:package-lock.json 2>/dev/null || true)"
            if git merge --ff-only "origin/$SYNC_BRANCH" >/dev/null 2>&1; then
                echo "[ATOM] Updated to $(git rev-parse --short HEAD)."
                NEW_LOCK="$(git rev-parse HEAD:package-lock.json 2>/dev/null || true)"
                if [ "$OLD_LOCK" != "$NEW_LOCK" ]; then
                    echo "[ATOM] Dependencies changed — running npm install..."
                    npm install --no-audit --no-fund --legacy-peer-deps \
                        || echo "[ATOM] WARNING: npm install failed; continuing with existing node_modules."
                fi
            else
                echo "[ATOM] Local history differs from origin/$SYNC_BRANCH — skipping auto-sync (fast-forward not possible)."
            fi
        fi
    else
        echo "[ATOM] Offline or GitHub unreachable — starting with current version."
    fi
fi

# Intel oneAPI + SYCL runtime env (inherited by llama-server child process).
if source_oneapi; then
  echo "[ATOM] oneAPI runtime loaded"
elif has_intel_gpu; then
  echo "[ATOM] WARNING: Intel GPU detected but oneAPI setvars.sh not found. SYCL may fall back to CPU."
  echo "[ATOM] Install oneAPI Base Toolkit, then: source /opt/intel/oneapi/setvars.sh"
fi
export_sycl_runtime_env

LLAMA_BIN="$(resolve_llama_server)"

echo "[ATOM] Starting..."
echo "[ATOM] llama-server binary: ${LLAMA_BIN}"
if has_intel_gpu && ! llama_bin_is_sycl "$LLAMA_BIN"; then
  echo "[ATOM] ERROR: Intel Arc detected but llama-server is not a SYCL build."
  echo "[ATOM] CPU-only inference on 27B models is ~7-10 tok/s. Build with -DGGML_SYCL=ON or set LLAMA_SERVER_BIN."
  echo "[ATOM] Run: ./scripts/check-gpu-setup.sh"
elif has_intel_gpu; then
  echo "[ATOM] SYCL binary OK. GPU flags: ctx=${ATOM_LLAMA_CTX} ubatch=${ATOM_LLAMA_UBATCH} ngl=${ATOM_LLAMA_NGL}"
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

# Restart CPU-only / misconfigured llama-server instead of silently reusing it.
if llama_ready && llama_server_needs_restart "$LLAMA_BIN" "$ROOT/llama-server.log"; then
    stop_llama_on_port "$ATOM_LLAMA_PORT" || true
    sleep 1
fi

# Check if llama-server is already running on 8080
if llama_ready; then
    pid="$(llama_port_pid)"
    echo "[ATOM] llama-server already running on port ${ATOM_LLAMA_PORT} (pid ${pid:-?})"
    if has_intel_gpu && ! llama_log_shows_sycl "$ROOT/llama-server.log" 2>/dev/null; then
        echo "[ATOM] Tip: if tok/s is low, run ./scripts/check-gpu-setup.sh or ATOM_RESTART_LLAMA=1 ./scripts/start-atom.sh"
    fi
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

    # shellcheck disable=SC2046
    LLAMA_GPU_ARGS=$(llama_server_common_args)

    if [ "$ROUTER" = 1 ]; then
        echo "[ATOM] Router: --models-dir $ATOM_MODELS_DIR --models-max 1 --no-models-autoload"
        echo "[ATOM] GPU: ${LLAMA_GPU_ARGS}"
        {
            echo "===== $(date -Iseconds) ATOM launch ====="
            echo "binary=${LLAMA_BIN}"
            echo "args=--models-dir ${ATOM_MODELS_DIR} --models-max 1 ${ROUTER_EXTRA[*]} ${LLAMA_GPU_ARGS} --port ${ATOM_LLAMA_PORT}"
        } >>"$ROOT/llama-server.log"
        # shellcheck disable=SC2086
        nohup "$LLAMA_BIN" --models-dir "$ATOM_MODELS_DIR" --models-max 1 "${ROUTER_EXTRA[@]}" $LLAMA_GPU_ARGS --port "$ATOM_LLAMA_PORT" --host 0.0.0.0 >>"$ROOT/llama-server.log" 2>&1 &
        LLAMA_PID=$!
        disown || true
    elif [ -n "$MODEL" ] && [ -f "$MODEL" ]; then
        echo "[ATOM] Using model (explicit or smallest GGUF): $MODEL"
        {
            echo "===== $(date -Iseconds) ATOM launch ====="
            echo "binary=${LLAMA_BIN}"
            echo "model=${MODEL}"
            echo "args=-m ${MODEL} ${LLAMA_GPU_ARGS} --port ${ATOM_LLAMA_PORT}"
        } >>"$ROOT/llama-server.log"
        # shellcheck disable=SC2086
        nohup "$LLAMA_BIN" -m "$MODEL" $LLAMA_GPU_ARGS --port "$ATOM_LLAMA_PORT" --host 0.0.0.0 >>"$ROOT/llama-server.log" 2>&1 &
        LLAMA_PID=$!
        disown || true
    else
        echo "[ATOM] No .gguf found for legacy -m mode and router unavailable (missing --models-dir in this binary or empty $ATOM_MODELS_DIR)."
        LLAMA_PID=""
    fi

    if [ -n "${LLAMA_PID:-}" ]; then
        LM_WAIT_ATTEMPTS="${LM_WAIT_ATTEMPTS:-120}"
        LM_WAIT_SLEEP="${LM_WAIT_SLEEP:-1}"
        echo "[ATOM] Waiting up to $((LM_WAIT_ATTEMPTS * LM_WAIT_SLEEP))s for llama HTTP on :${ATOM_LLAMA_PORT} ..."
        llama_ok=0
        for ((i = 1; i <= LM_WAIT_ATTEMPTS; i++)); do
            if ! kill -0 "$LLAMA_PID" 2>/dev/null; then
                echo "[ATOM] ERROR: llama-server process exited (PID $LLAMA_PID). Last lines of llama-server.log:"
                tail -n 60 "$ROOT/llama-server.log" 2>/dev/null || true
                break
            fi
            if llama_ready; then
                echo "[ATOM] llama-server ready (${i}x${LM_WAIT_SLEEP}s)"
                if has_intel_gpu; then
                    sleep 1
                    if llama_log_shows_sycl "$ROOT/llama-server.log"; then
                        echo "[ATOM] SYCL backend confirmed in llama-server.log"
                    elif llama_log_shows_cpu_only "$ROOT/llama-server.log"; then
                        echo "[ATOM] WARNING: llama-server.log shows CPU backend — expect low tok/s. Run ./scripts/check-gpu-setup.sh"
                    fi
                fi
                llama_ok=1
                break
            fi
            sleep "$LM_WAIT_SLEEP"
        done
        if [ "$llama_ok" != 1 ]; then
            if kill -0 "$LLAMA_PID" 2>/dev/null; then
                echo "[ATOM] WARNING: llama-server not answering on :${ATOM_LLAMA_PORT} yet — UI will start; retry when the server is ready."
            fi
        fi
    fi
fi

# Hardware metrics bridge (Intel VRAM + NVIDIA via pynvml)
if [ -f scripts/hardware_server.py ]; then
    if ! curl -sS --max-time 1 "http://127.0.0.1:5000/metrics" >/dev/null 2>&1; then
        HW_PY="python3"
        if [ -x scripts/.venv-hw/bin/python ]; then
            HW_PY="scripts/.venv-hw/bin/python"
        elif python3 -c "import flask, psutil" 2>/dev/null; then
            HW_PY="python3"
        else
            echo "[ATOM] Tip: pip install -r scripts/requirements-hardware.txt for GPU VRAM metrics in the UI"
            HW_PY=""
        fi
        if [ -n "$HW_PY" ]; then
            nohup "$HW_PY" scripts/hardware_server.py >>"$ROOT/hardware-server.log" 2>&1 &
            disown || true
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
