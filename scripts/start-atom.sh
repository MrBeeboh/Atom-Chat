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
# Both cards stay visible (level_zero:0,1). Default load is the second B70
# (SYCL1, split none) so the desktop card stays free. The 80B (and any other
# >30GB GGUF) splits via ~/.config/llama/models-preset.ini.
# --parallel 1 keeps the full KV for one conversation (auto was 4 slots).
# On launch, other apps' local models are unloaded first (see free_other_local_models).
# Skip GPU flags: ATOM_SKIP_B70_FLAGS=1
# Skip ejecting others: ATOM_SKIP_UNLOAD_OTHERS=1
# Force split: ATOM_LLAMA_SPLIT=layer
# Tensor parallel: ATOM_LLAMA_SPLIT=tensor
apply_b70_runtime_env() {
  if [ -n "${ATOM_SKIP_B70_FLAGS:-}" ]; then
    return
  fi
  # Keep both Level Zero GPUs visible so --device SYCL0/SYCL1 works.
  export ONEAPI_DEVICE_SELECTOR="${ONEAPI_DEVICE_SELECTOR:-level_zero:0,1}"
  export ZES_ENABLE_SYSMAN="${ZES_ENABLE_SYSMAN:-1}"
  export UR_L0_ENABLE_RELAXED_ALLOCATION_LIMITS="${UR_L0_ENABLE_RELAXED_ALLOCATION_LIMITS:-1}"
  export GGML_SYCL_ENABLE_FLASH_ATTN="${GGML_SYCL_ENABLE_FLASH_ATTN:-1}"
  export GGML_SYCL_ENABLE_OPT="${GGML_SYCL_ENABLE_OPT:-1}"
  # B70 SYCL JIT cache has been a crash source. Keep it off unless the user sets it.
  export SYCL_CACHE_PERSISTENT="${SYCL_CACHE_PERSISTENT:-0}"
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

  # Parent --device/--split-mode beat models-preset.ini, so only pass them
  # when the operator explicitly overrides. Default placement is in
  # ~/.config/llama/models-preset.ini (SYCL1 singles, 80B split).
  if [ -n "${ATOM_LLAMA_SPLIT:-}${ATOM_LLAMA_DEVICE:-}" ]; then
    local split="${ATOM_LLAMA_SPLIT:-none}"
    if [ "$split" != "none" ] && [ "$have_two" != 1 ]; then
      echo "[ATOM] ${split} split requested but only one SYCL GPU is visible — using --split-mode none"
      split=none
    fi
    if llama_has 'split-mode'; then
      LLAMA_GPU_FLAGS+=(--split-mode "$split")
    fi

    if [ "$split" = "none" ]; then
      if [ "$is_sycl" = 1 ] && llama_has '--device <dev'; then
        LLAMA_GPU_FLAGS+=(--device "${ATOM_LLAMA_DEVICE:-SYCL1}")
      elif llama_has 'main-gpu'; then
        LLAMA_GPU_FLAGS+=(--main-gpu "${ATOM_LLAMA_GPU:-1}")
      fi
    else
      if [ "$is_sycl" = 1 ] && llama_has '--device <dev'; then
        LLAMA_GPU_FLAGS+=(--device "${ATOM_LLAMA_DEVICE:-SYCL0,SYCL1}")
      fi
      if llama_has 'tensor-split'; then
        LLAMA_GPU_FLAGS+=(--tensor-split "${ATOM_TENSOR_SPLIT:-0.45,0.55}")
      fi
    fi
  else
    echo "[ATOM] GPU placement from models-preset.ini (singles=SYCL1, 80B=both cards)"
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
    # POLICY: local models always run at their own trained maximum context.
    # --ctx-size 0 = the GGUF's n_ctx_train (matches ~/.local/bin/llama-server-direct).
    # Never cap to 32768 (or any "family cap"). To force a specific window for a
    # one-off experiment, set ATOM_CTX=<n>; 32768 is refused and treated as 0.
    local ctx="${ATOM_CTX:-0}"
    if [ "$ctx" = "32768" ]; then
      echo "[ATOM] ATOM_CTX=32768 refused (policy: native max). Using --ctx-size 0." >&2
      ctx=0
    fi
    LLAMA_GPU_FLAGS+=(--ctx-size "$ctx")
    # KV cache type. A full f16 cache at 262144 is what made decode crawl, so at native
    # context default to q4_0 K/V (same as llama-server-direct). Between 32k and native
    # a q8_0 cache is used. ATOM_KV_QUANT: 0 = f16, 1 = q8_0, or q4_0 / q8_0 / f16.
    local kv="${ATOM_KV_QUANT:-}"
    local kvtype=""
    case "$kv" in
      0) kvtype="" ;;
      1) kvtype="q8_0" ;;
      q4_0|q8_0|f16) kvtype="$kv" ;;
      *)
        if [ "$ctx" = "0" ]; then
          kvtype="q4_0"
        elif [ "$ctx" -ge 32768 ] 2>/dev/null; then
          kvtype="q8_0"
        fi
        ;;
    esac
    if [ -n "$kvtype" ] && llama_has 'cache-type-k'; then
      LLAMA_GPU_FLAGS+=(--cache-type-k "$kvtype" --cache-type-v "$kvtype")
    fi
  fi
  if llama_has 'batch-size' && [ -z "${ATOM_BATCH:-}" ]; then
    LLAMA_GPU_FLAGS+=(--batch-size "${ATOM_BATCH:-512}")
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
  local flash
  flash="$(pid_listening_on 8081)"
  local pid
  local killed=0
  for pid in $(llama_server_pids); do
    [ -z "$pid" ] && continue
    if [ -n "$keep" ] && pid_is_in_tree "$pid" "$keep"; then
      continue
    fi
    # Flash-Next shards listen on :8081. Never unload or signal them.
    if [ -n "$flash" ] && { [ "$pid" = "$flash" ] || pid_is_in_tree "$pid" "$flash"; }; then
      echo "[ATOM] Leaving llama-server PID $pid on :8081 alone"
      continue
    fi
    if tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null | grep -q -- '--port 8081'; then
      echo "[ATOM] Leaving llama-server PID $pid (--port 8081) alone"
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
        if [ -n "$flash" ] && { [ "$pid" = "$flash" ] || pid_is_in_tree "$pid" "$flash"; }; then
          continue
        fi
        if tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null | grep -q -- '--port 8081'; then
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
      if [ -n "$flash" ] && { [ "$pid" = "$flash" ] || pid_is_in_tree "$pid" "$flash"; }; then
        continue
      fi
      if tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null | grep -q -- '--port 8081'; then
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

# Router models-dir: llama.cpp only indexes *top-level* .gguf files and *immediate*
# subfolders (one GGUF each). Nested LM Studio trees (~/.lmstudio/models/org/repo/)
# therefore expose almost nothing. Prefer ~/models/library which is already flat /
# one-folder-per-model (symlinks into hub).
pick_atom_models_dir() {
  if [ -n "${ATOM_MODELS_DIR:-}" ] && [ -d "$ATOM_MODELS_DIR" ]; then
    printf '%s' "$ATOM_MODELS_DIR"
    return
  fi
  local lib="$HOME/models/library"
  local lms="$HOME/.lmstudio/models"
  local lib_n=0
  if [ -d "$lib" ]; then
    lib_n="$(find "$lib" -maxdepth 1 \( -name '*.gguf' -o -type d ! -name '.' ! -name '..' \) 2>/dev/null | wc -l | tr -d ' ')"
  fi
  if [ "${lib_n:-0}" -gt 0 ]; then
    printf '%s' "$lib"
    return
  fi
  if [ -d "$lms" ]; then
    printf '%s' "$lms"
    return
  fi
  printf '%s' "$lib"
}

stop_llama_on_8080() {
  # Only the process listening on :8080. Never signal every llama-server on the
  # box — that includes the Flash-Next server on :8081.
  local pid
  pid="$(pid_listening_on 8080)"
  if [ -z "$pid" ]; then
    return 0
  fi
  local cmd
  cmd="$(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null || true)"
  if printf '%s' "$cmd" | grep -q 'llama-8080-flash-proxy'; then
    echo "[ATOM] Refusing to stop the shared :8080 router proxy" >&2
    return 0
  fi
  systemctl --user stop llama-server.service 2>/dev/null || true
  pid="$(pid_listening_on 8080)"
  if [ -n "$pid" ]; then
    kill -TERM "$pid" 2>/dev/null || true
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
  fi
  sleep 0.5
}

# The desktop backend is the shared router on :8080 (llama-8080-flash-proxy →
# llama-server on 127.0.0.1:18080). Its listener cmdline has no --ctx-size /
# --models-dir / --split-mode, so the mismatch checks below must not restart it.
shared_router_on_8080() {
  local pid cmd
  pid="$(pid_listening_on 8080)"
  [ -n "$pid" ] || return 1
  cmd="$(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null || true)"
  printf '%s' "$cmd" | grep -q 'llama-8080-flash-proxy'
}

running_router_models_dir() {
  local pid
  pid="$(pid_listening_on 8080)"
  [ -n "$pid" ] || return 0
  # cmdline is null-separated in /proc; show as spaces
  tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null | awk '
    {
      for (i = 1; i <= NF; i++) {
        if ($i == "--models-dir" && (i + 1) <= NF) { print $(i + 1); exit }
      }
    }'
}

running_split_mode() {
  local pid
  pid="$(pid_listening_on 8080)"
  [ -n "$pid" ] || return 0
  tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null | awk '
    {
      for (i = 1; i <= NF; i++) {
        if ($i == "--split-mode" && (i + 1) <= NF) { print $(i + 1); exit }
      }
    }'
}

wanted_split_mode() {
  local i
  for ((i = 0; i < ${#LLAMA_GPU_FLAGS[@]}; i++)); do
    if [ "${LLAMA_GPU_FLAGS[$i]}" = "--split-mode" ]; then
      printf '%s' "${LLAMA_GPU_FLAGS[$((i + 1))]:-}"
      return
    fi
  done
}

running_ctx_size() {
  local pid
  pid="$(pid_listening_on 8080)"
  [ -n "$pid" ] || return 0
  tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null | awk '
    {
      for (i = 1; i <= NF; i++) {
        if (($i == "--ctx-size" || $i == "-c") && (i + 1) <= NF) { print $(i + 1); exit }
      }
    }'
}

wanted_ctx_size() {
  local i
  for ((i = 0; i < ${#LLAMA_GPU_FLAGS[@]}; i++)); do
    if [ "${LLAMA_GPU_FLAGS[$i]}" = "--ctx-size" ]; then
      printf '%s' "${LLAMA_GPU_FLAGS[$((i + 1))]:-}"
      return
    fi
  done
}

# Check if llama-server is already running on 8080
ATOM_MODELS_DIR="$(pick_atom_models_dir)"
export ATOM_MODELS_DIR

# Keep ~/models/library populated with flat / one-folder-per-model symlinks so the
# router can see weights that live under nested LM Studio paths.
if [ -x "$ROOT/scripts/sync-router-library.sh" ] || [ -f "$ROOT/scripts/sync-router-library.sh" ]; then
  bash "$ROOT/scripts/sync-router-library.sh" || echo "[ATOM] sync-router-library skipped/failed (non-fatal)"
fi
# Re-pick after sync (library may have been empty before).
ATOM_MODELS_DIR="$(pick_atom_models_dir)"
export ATOM_MODELS_DIR

if shared_router_on_8080; then
    echo "[ATOM] Shared router already listening on :8080 — not restarting it, not touching :8081."
elif llama_ready; then
    live_ctx="$(running_ctx_size || true)"
    want_ctx="$(wanted_ctx_size || true)"
    if [ -n "$want_ctx" ] && [ "${live_ctx:-}" != "$want_ctx" ]; then
        echo "[ATOM] Router ctx-size mismatch: live=${live_ctx:-unset} want=$want_ctx — restarting llama-server"
        stop_llama_on_8080
    fi
fi

# Restart if the live router is pointed at the wrong models-dir (e.g. nested
# ~/.lmstudio/models that only exposes one preset like qwen38).
if ! shared_router_on_8080 && llama_ready; then
    live_dir="$(running_router_models_dir || true)"
    want_dir="$ATOM_MODELS_DIR"
    if [ -n "$live_dir" ] && [ -n "$want_dir" ] && [ "$live_dir" != "$want_dir" ]; then
        echo "[ATOM] Router models-dir mismatch: live=$live_dir want=$want_dir — restarting llama-server"
        stop_llama_on_8080
    fi
fi

# Restart if the live process was started with a different --split-mode
# (e.g. leftover none/tensor from a speed experiment).
if ! shared_router_on_8080 && llama_ready; then
    live_split="$(running_split_mode || true)"
    want_split="$(wanted_split_mode || true)"
    if [ -n "$want_split" ] && [ "${live_split:-}" != "$want_split" ]; then
        echo "[ATOM] Router split-mode mismatch: live=${live_split:-unset} want=$want_split — restarting llama-server"
        stop_llama_on_8080
    fi
fi

if llama_ready; then
    echo "[ATOM] llama-server already running on port 8080 (models-dir=${ATOM_MODELS_DIR})"
    echo "[ATOM] (B70 flags above apply only after you stop that process and relaunch)"
else
    echo "[ATOM] Starting llama-server..."

    # Prefer router mode: nothing in VRAM until the first chat. Default llama.cpp
    # --models-autoload (on) lets /v1/chat/completions LRU-evict and load the
    # requested model in one request — that is the fast Arena switch path.
    ROUTER=0
    if [ -z "${MODEL:-}" ] && [ -z "${GGUF_PATH:-}" ] && [ -d "$ATOM_MODELS_DIR" ] && llama_has 'models-dir'; then
        ROUTER=1
    fi

    if [ -n "${MODEL:-}" ] || [ -n "${GGUF_PATH:-}" ]; then
        MODEL="${MODEL:-$GGUF_PATH}"
    elif [ "$ROUTER" = 1 ]; then
        MODEL=""
    else
        MODEL="$(pick_smallest_gguf)"
    fi

    if [ "$ROUTER" = 1 ]; then
        ROUTER_PRESET_FLAGS=()
        if [ -z "${ATOM_MODELS_PRESET:-}" ]; then
            if [ -f "$HOME/.config/llama/models-preset.ini" ]; then
                ATOM_MODELS_PRESET="$HOME/.config/llama/models-preset.ini"
            else
                ATOM_MODELS_PRESET="$ROOT/config/llama-models.ini"
            fi
        fi
        if [ -f "$ATOM_MODELS_PRESET" ] && llama_has 'models-preset'; then
            ROUTER_PRESET_FLAGS+=(--models-preset "$ATOM_MODELS_PRESET")
            echo "[ATOM] Router preset: $ATOM_MODELS_PRESET"
        fi
        echo "[ATOM] Router: --models-dir $ATOM_MODELS_DIR --models-max 1 (autoload on; nothing preloaded into VRAM)"
        : >>"$ROOT/llama-server.log"
        {
          echo "[ATOM] $(date -Iseconds) start router models-dir=$ATOM_MODELS_DIR ${ROUTER_PRESET_FLAGS[*]} ${LLAMA_GPU_FLAGS[*]}"
        } >>"$ROOT/llama-server.log"
        nohup "$LLAMA_BIN" --models-dir "$ATOM_MODELS_DIR" --models-max 1 "${ROUTER_PRESET_FLAGS[@]}" "${LLAMA_GPU_FLAGS[@]}" --port 8080 --host 0.0.0.0 >>"$ROOT/llama-server.log" 2>&1 &
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

atom_ui_is_ours() {
    curl -sS --max-time 1 "http://localhost:${ATOM_UI_PORT}/" 2>/dev/null | grep -q '<title>ATOM</title>'
}

free_foreign_ui_port() {
    local pid cwd cmd
    pid="$(pid_listening_on "$ATOM_UI_PORT")"
    [ -n "$pid" ] || return 0
    cwd="$(readlink -f "/proc/${pid}/cwd" 2>/dev/null || true)"
    cmd="$(tr '\0' ' ' <"/proc/${pid}/cmdline" 2>/dev/null || true)"
    if [ "$cwd" = "$ROOT" ] || printf '%s' "$cmd" | grep -q '/atom-chat'; then
        return 0
    fi
    echo "[ATOM] Port ${ATOM_UI_PORT} is taken by PID ${pid} (${cwd:-unknown cwd}) — not ATOM. Reclaiming it."
    kill -TERM "$pid" 2>/dev/null || true
    sleep 1
    if pid_listening_on "$ATOM_UI_PORT" >/dev/null; then
        kill -KILL "$pid" 2>/dev/null || true
        sleep 0.3
    fi
}

open_atom_browser() {
    echo "[ATOM] Opening browser: http://localhost:${ATOM_UI_PORT}/"
    # Detach so the desktop terminal cannot SIGHUP xdg-open when this script
    # exits (that was dropping the browser open on the already-running path).
    nohup xdg-open "http://localhost:${ATOM_UI_PORT}/" >/dev/null 2>&1 &
    disown || true
}

# True when the Vite listener is a descendant of this launcher. A Vite started
# by hand (npm parent is init) is not — the shortcut used to see the title,
# background xdg-open, and exit, so the terminal closed before the browser opened.
ui_owned_by_this_launcher() {
    local pid
    pid="$(pid_listening_on "$ATOM_UI_PORT")"
    [ -n "$pid" ] || return 1
    pid_is_in_tree "$pid" "$$"
}

stop_stale_atom_ui() {
    local pid cwd cmd
    pid="$(pid_listening_on "$ATOM_UI_PORT")"
    [ -n "$pid" ] || return 0
    if ui_owned_by_this_launcher; then
        return 0
    fi
    cwd="$(readlink -f "/proc/${pid}/cwd" 2>/dev/null || true)"
    cmd="$(tr '\0' ' ' <"/proc/${pid}/cmdline" 2>/dev/null || true)"
    if [ "$cwd" != "$ROOT" ] && ! printf '%s' "$cmd" | grep -q '/atom-chat'; then
        return 0
    fi
    echo "[ATOM] Stale Vite on port ${ATOM_UI_PORT} (node PID ${pid}, not started by start-atom.sh) — stopping only that node process."
    kill -TERM "$pid" 2>/dev/null || true
    local i
    for i in 1 2 3 4 5 6 7 8 9 10; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.3
    done
    if kill -0 "$pid" 2>/dev/null; then
        kill -KILL "$pid" 2>/dev/null || true
    fi
    for i in 1 2 3 4 5 6 7 8 9 10; do
        [ -z "$(pid_listening_on "$ATOM_UI_PORT")" ] && return 0
        sleep 0.3
    done
}

if atom_ui_is_ours; then
    if ui_owned_by_this_launcher; then
        echo "[ATOM] UI already running on http://localhost:${ATOM_UI_PORT}/ — opening browser."
        open_atom_browser
        exit 0
    fi
    echo "[ATOM] Port ${ATOM_UI_PORT} is serving ATOM, but Vite was not started by this launcher."
    stop_stale_atom_ui
fi

free_foreign_ui_port

if atom_ui_is_ours; then
    if ui_owned_by_this_launcher; then
        echo "[ATOM] UI already running on http://localhost:${ATOM_UI_PORT}/ — opening browser."
        open_atom_browser
        exit 0
    fi
    stop_stale_atom_ui
fi

npm run dev -- --port "$ATOM_UI_PORT" --strictPort &
UI_PID=$!

# Open browser once THIS app responds (HTTP 200 on another app used to count as "ready").
ui_ok=0
for i in $(seq 1 40); do
    if atom_ui_is_ours; then
        open_atom_browser
        ui_ok=1
        break
    fi
    if ! kill -0 "$UI_PID" 2>/dev/null; then
        echo "[ATOM] ERROR: Vite exited before the UI came up (often: port ${ATOM_UI_PORT} still busy)." >&2
        break
    fi
    sleep 0.5
done

if [ "$ui_ok" != 1 ]; then
    echo "[ATOM] UI did not start on http://localhost:${ATOM_UI_PORT}/" >&2
    if [ -t 0 ] && [ -t 1 ]; then
        read -r -p "[ATOM] Press Enter to close this window..." _
    fi
    wait "$UI_PID" 2>/dev/null || true
    exit 1
fi

trap 'kill $UI_PID 2>/dev/null; exit 0' INT TERM
wait $UI_PID || true
