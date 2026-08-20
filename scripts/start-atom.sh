#!/usr/bin/env bash
# ATOM - llama.cpp launcher (one double-click)

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

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

# --- Arc Pro B70 / Intel SYCL defaults ---------------------------------------
# ATOM takes both cards: layer-split 50/50 + Flash Attention (Xe2 XMX).
# --parallel 1 keeps the full KV for one conversation (auto was 4 slots).
# On launch, other apps' local models are unloaded first (see free_other_local_models).
# Skip GPU flags: ATOM_SKIP_B70_FLAGS=1
# Skip ejecting others: ATOM_SKIP_UNLOAD_OTHERS=1
# One card only: ATOM_LLAMA_SPLIT=none ATOM_LLAMA_DEVICE=SYCL0
# Tensor parallel instead of layer: ATOM_LLAMA_SPLIT=tensor
apply_b70_runtime_env() {
  if [ -n "${ATOM_SKIP_B70_FLAGS:-}" ]; then
    return
  fi
  # Keep both Level Zero GPUs visible so --device SYCL0/SYCL1 works.
  export ONEAPI_DEVICE_SELECTOR="${ONEAPI_DEVICE_SELECTOR:-level_zero:gpu}"
  export ZES_ENABLE_SYSMAN="${ZES_ENABLE_SYSMAN:-1}"
  export UR_L0_ENABLE_RELAXED_ALLOCATION_LIMITS="${UR_L0_ENABLE_RELAXED_ALLOCATION_LIMITS:-1}"
  export GGML_SYCL_ENABLE_FLASH_ATTN="${GGML_SYCL_ENABLE_FLASH_ATTN:-1}"
  export GGML_SYCL_ENABLE_OPT="${GGML_SYCL_ENABLE_OPT:-1}"
  if [ -n "${ATOM_SYCL_FA_ONEDNN:-}" ]; then
    export GGML_SYCL_FA_ONEDNN="${ATOM_SYCL_FA_ONEDNN}"
  fi
}

llama_has() {
  printf '%s' "${LLAMA_HELP}" | grep -qE -- "$1"
}

build_llama_gpu_flags() {
  LLAMA_GPU_FLAGS=()
  if [ -n "${ATOM_SKIP_B70_FLAGS:-}" ]; then
    if llama_has 'n-gpu-layers'; then
      LLAMA_GPU_FLAGS+=(--n-gpu-layers "${ATOM_N_GPU_LAYERS:-99}")
    fi
    return
  fi

  local ngl
  if llama_has "or 'all'"; then
    ngl="${ATOM_N_GPU_LAYERS:-all}"
  else
    ngl="${ATOM_N_GPU_LAYERS:-999}"
  fi
  if llama_has 'n-gpu-layers'; then
    LLAMA_GPU_FLAGS+=(--n-gpu-layers "$ngl")
  fi

  if llama_has 'flash-attn \[on'; then
    LLAMA_GPU_FLAGS+=(--flash-attn "${ATOM_FLASH_ATTN:-on}")
  elif llama_has 'flash-attn'; then
    LLAMA_GPU_FLAGS+=(--flash-attn)
  fi

  local is_sycl=0
  if echo "${LLAMA_BIN}" | grep -qi sycl || printf '%s' "${LLAMA_HELP}" | grep -qi SYCL; then
    is_sycl=1
  fi

  local have_two=0
  if [ "$is_sycl" = 1 ] && printf '%s' "${SYCL_DEVICE_LIST}" | grep -q 'SYCL1:'; then
    have_two=1
  fi

  local split="${ATOM_LLAMA_SPLIT:-}"
  if [ -z "$split" ]; then
    if [ "$have_two" = 1 ]; then
      split=layer
    else
      split=none
    fi
  fi
  if llama_has 'split-mode'; then
    LLAMA_GPU_FLAGS+=(--split-mode "$split")
  fi

  if [ "$split" = "none" ]; then
    if [ "$is_sycl" = 1 ] && llama_has '--device <dev'; then
      LLAMA_GPU_FLAGS+=(--device "${ATOM_LLAMA_DEVICE:-SYCL0}")
    elif llama_has 'main-gpu'; then
      LLAMA_GPU_FLAGS+=(--main-gpu "${ATOM_LLAMA_GPU:-0}")
    fi
  else
    if [ "$is_sycl" = 1 ] && llama_has '--device <dev'; then
      LLAMA_GPU_FLAGS+=(--device "${ATOM_LLAMA_DEVICE:-SYCL0,SYCL1}")
    fi
    if llama_has 'tensor-split'; then
      LLAMA_GPU_FLAGS+=(--tensor-split "${ATOM_TENSOR_SPLIT:-0.50,0.50}")
    fi
  fi

  if llama_has '--parallel N'; then
    LLAMA_GPU_FLAGS+=(--parallel "${ATOM_LLAMA_PARALLEL:-1}")
  fi

  if [ -n "${ATOM_UBATCH:-}" ] && llama_has 'ubatch-size'; then
    LLAMA_GPU_FLAGS+=(--ubatch-size "${ATOM_UBATCH}")
  fi
  if [ -n "${ATOM_BATCH:-}" ] && llama_has 'batch-size'; then
    LLAMA_GPU_FLAGS+=(--batch-size "${ATOM_BATCH}")
  fi
  if llama_has 'ctx-size'; then
    # 0 = GGUF n_ctx_train (this model's max). Never default to 32768.
    local ctx="${ATOM_CTX:-0}"
    if [ "$ctx" = "32768" ]; then
      ctx=0
    fi
    LLAMA_GPU_FLAGS+=(--ctx-size "$ctx")
  fi
  if [ "${ATOM_KV_QUANT:-}" = "1" ] && llama_has 'cache-type-k'; then
    LLAMA_GPU_FLAGS+=(--cache-type-k q8_0 --cache-type-v q8_0)
  fi
}

apply_b70_runtime_env
LLAMA_HELP="$("${LLAMA_BIN}" --help 2>&1 || true)"
SYCL_DEVICE_LIST=""
if echo "${LLAMA_BIN}" | grep -qi sycl || printf '%s' "${LLAMA_HELP}" | grep -qi SYCL; then
  SYCL_DEVICE_LIST="$("${LLAMA_BIN}" --list-devices 2>/dev/null || true)"
fi
build_llama_gpu_flags
if [ "${#LLAMA_GPU_FLAGS[@]}" -gt 0 ]; then
  echo "[ATOM] llama GPU flags: ${LLAMA_GPU_FLAGS[*]}"
fi
if [ -z "${ATOM_SKIP_B70_FLAGS:-}" ]; then
  echo "[ATOM] SYCL env: ONEAPI_DEVICE_SELECTOR=${ONEAPI_DEVICE_SELECTOR:-unset} ZES_ENABLE_SYSMAN=${ZES_ENABLE_SYSMAN:-unset} UR_L0_ENABLE_RELAXED_ALLOCATION_LIMITS=${UR_L0_ENABLE_RELAXED_ALLOCATION_LIMITS:-unset}"
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

pid_listening_on() {
  local port="$1"
  ss -H -ltnp "sport = :${port}" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1 || true
}

llama_server_pids() {
  ps -C llama-server -o pid= 2>/dev/null | tr -d ' ' | awk 'NF' || true
}

pid_is_in_tree() {
  local pid="$1"
  local root="$2"
  local cur="$pid"
  local pp
  [ -z "$root" ] && return 1
  while [ -n "$cur" ] && [ "$cur" != 0 ]; do
    if [ "$cur" = "$root" ]; then
      return 0
    fi
    pp="$(ps -o ppid= -p "$cur" 2>/dev/null | tr -d ' ' || true)"
    if [ -z "$pp" ] || [ "$pp" = "$cur" ]; then
      break
    fi
    cur="$pp"
  done
  return 1
}

# Unload every other local inference holder so both B70s are free for ATOM.
# Keeps the llama-server tree on :8080 (ATOM's backend and its loaded-model children).
free_other_local_models() {
  if [ -n "${ATOM_SKIP_UNLOAD_OTHERS:-}" ]; then
    echo "[ATOM] Skipping unload of other apps (ATOM_SKIP_UNLOAD_OTHERS=1)"
    return
  fi

  echo "[ATOM] Unloading other apps' local models (both GPUs for ATOM)..."

  local lms_bin=""
  if command -v lms >/dev/null 2>&1; then
    lms_bin="$(command -v lms)"
  elif [ -x "$HOME/.lmstudio/bin/lms" ]; then
    lms_bin="$HOME/.lmstudio/bin/lms"
  fi
  if [ -n "$lms_bin" ]; then
    if timeout 20 "$lms_bin" unload --all >/dev/null 2>&1; then
      echo "[ATOM] LM Studio: unloaded"
    else
      echo "[ATOM] LM Studio: unload skipped (none loaded, or lms timed out)"
    fi
  fi

  if command -v ollama >/dev/null 2>&1; then
    local names
    names="$(timeout 10 ollama ps 2>/dev/null | awk 'NR > 1 && $1 != "" && $1 != "NAME" { print $1 }')"
    if [ -n "$names" ]; then
      while IFS= read -r name; do
        [ -z "$name" ] && continue
        timeout 20 ollama stop "$name" >/dev/null 2>&1 && echo "[ATOM] Ollama: stopped $name" || true
      done <<< "$names"
    fi
  fi

  if ss -H -ltn "sport = :8188" 2>/dev/null | grep -q .; then
    curl -sS --max-time 5 -X POST "http://127.0.0.1:8188/free" \
      -H "Content-Type: application/json" \
      -d '{"unload_models":true,"free_memory":true}' >/dev/null 2>&1 \
      || curl -sS --max-time 5 -X POST "http://127.0.0.1:8188/api/free" \
        -H "Content-Type: application/json" \
        -d '{"unload_models":true,"free_memory":true}' >/dev/null 2>&1 \
      || true
    echo "[ATOM] ComfyUI: asked to unload models"
  fi

  local keep
  keep="$(pid_listening_on 8080)"
  local pid
  local killed=0
  for pid in $(llama_server_pids); do
    [ -z "$pid" ] && continue
    if [ -n "$keep" ] && pid_is_in_tree "$pid" "$keep"; then
      continue
    fi
    echo "[ATOM] Stopping other llama-server PID $pid"
    kill -TERM "$pid" 2>/dev/null || true
    killed=1
  done
  if [ "$killed" = 1 ]; then
    local i
    for i in 1 2 3 4 5 6 7 8 9 10; do
      local leftover=0
      for pid in $(llama_server_pids); do
        [ -z "$pid" ] && continue
        if [ -n "$keep" ] && pid_is_in_tree "$pid" "$keep"; then
          continue
        fi
        leftover=1
        break
      done
      [ "$leftover" = 0 ] && break
      sleep 0.5
    done
    for pid in $(llama_server_pids); do
      [ -z "$pid" ] && continue
      if [ -n "$keep" ] && pid_is_in_tree "$pid" "$keep"; then
        continue
      fi
      echo "[ATOM] Killing leftover llama-server PID $pid"
      kill -KILL "$pid" 2>/dev/null || true
    done
  fi
}

free_other_local_models

probe_running_n_ctx() {
  python3 - <<'PY' 2>/dev/null || echo 0
import json, urllib.request
try:
    with urllib.request.urlopen("http://127.0.0.1:8080/props", timeout=2) as r:
        d = json.load(r)
    gs = d.get("default_generation_settings") or {}
    print(int(gs.get("n_ctx") or 0))
except Exception:
    print(0)
PY
}

# Check if llama-server is already running on 8080
if llama_ready; then
    running_ctx="$(probe_running_n_ctx | tr -d '[:space:]')"
    if [ "$running_ctx" = "32768" ]; then
        echo "[ATOM] Port 8080 is capped at 32768 — restarting with --ctx-size 0 (this model's trained max)"
        systemctl --user stop llama-server.service 2>/dev/null || true
        pid="$(pid_listening_on 8080)"
        if [ -n "$pid" ]; then
            kill -TERM "$pid" 2>/dev/null || true
            sleep 1
            kill -KILL "$pid" 2>/dev/null || true
        fi
    fi
fi

if llama_ready; then
    echo "[ATOM] llama-server already running on port 8080"
    echo "[ATOM] (B70 flags above apply only after you stop that process and relaunch)"
else
    echo "[ATOM] Starting llama-server..."

    ATOM_MODELS_DIR="${ATOM_MODELS_DIR:-$HOME/.lmstudio/models}"
    # Prefer router mode: no GGUF in VRAM until the app calls /models/load (Arena loads one at a time).
    ROUTER=0
    if [ -z "${MODEL:-}" ] && [ -z "${GGUF_PATH:-}" ] && [ -d "$ATOM_MODELS_DIR" ] && llama_has 'models-dir'; then
        ROUTER=1
    fi
    ROUTER_EXTRA=()
    if [ "$ROUTER" = 1 ] && llama_has 'no-models-autoload'; then
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
        {
          echo "[ATOM] $(date -Iseconds) start router ${LLAMA_GPU_FLAGS[*]}"
        } >>"$ROOT/llama-server.log"
        nohup "$LLAMA_BIN" --models-dir "$ATOM_MODELS_DIR" --models-max 1 "${ROUTER_EXTRA[@]}" "${LLAMA_GPU_FLAGS[@]}" --port 8080 --host 0.0.0.0 >>"$ROOT/llama-server.log" 2>&1 &
        LLAMA_PID=$!
        disown || true
    elif [ -n "$MODEL" ] && [ -f "$MODEL" ]; then
        echo "[ATOM] Using model (explicit or smallest GGUF): $MODEL"
        : >>"$ROOT/llama-server.log"
        {
          echo "[ATOM] $(date -Iseconds) start -m $MODEL ${LLAMA_GPU_FLAGS[*]}"
        } >>"$ROOT/llama-server.log"
        nohup "$LLAMA_BIN" -m "$MODEL" "${LLAMA_GPU_FLAGS[@]}" --port 8080 --host 0.0.0.0 >>"$ROOT/llama-server.log" 2>&1 &
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
if [ -f "$ROOT/voice-server/app.py" ]; then
    if [ -x "$ROOT/voice-server/.venv/bin/python" ]; then
        VOICE_PY="$ROOT/voice-server/.venv/bin/python"
    else
        VOICE_PY="python3"
    fi
    (cd "$ROOT/voice-server" && nohup "$VOICE_PY" -m uvicorn app:app --host 0.0.0.0 --port 8765 >> "$ROOT/voice-server.log" 2>&1 &)
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
