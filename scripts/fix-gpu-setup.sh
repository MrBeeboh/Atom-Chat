#!/usr/bin/env bash
# One-command Intel Arc GPU fix for ATOM. Safe to run from any directory.
# Usage:  bash /path/to/atom-v2/scripts/fix-gpu-setup.sh
#    or:  curl -fsSL .../scripts/fix-gpu-setup.sh | bash

set -euo pipefail

find_atom_repo() {
  local candidate
  if [ -n "${ATOM_REPO:-}" ] && [ -f "${ATOM_REPO}/scripts/start-atom.sh" ]; then
    echo "${ATOM_REPO}"
    return 0
  fi
  for candidate in \
    "$HOME/atom-v2" \
    "$HOME/atom-chat" \
    "$HOME/Atom-Chat" \
    "$HOME/.lmstudio/atom-chat" \
    "$HOME/projects/atom-v2" \
    "$HOME/projects/Atom-Chat"; do
    if [ -f "$candidate/scripts/start-atom.sh" ]; then
      echo "$candidate"
      return 0
    fi
  done
  if [ -f "$HOME/.local/share/applications/ATOM.desktop" ]; then
    local path_line exec_line dir
    path_line="$(grep -E '^Path=' "$HOME/.local/share/applications/ATOM.desktop" 2>/dev/null | head -1 | cut -d= -f2-)"
    if [ -n "$path_line" ] && [ -f "$path_line/scripts/start-atom.sh" ]; then
      echo "$path_line"
      return 0
    fi
    exec_line="$(grep -E '^Exec=' "$HOME/.local/share/applications/ATOM.desktop" 2>/dev/null | head -1)"
    dir="$(echo "$exec_line" | sed -n 's/.*cd \([^ &]*\).*/\1/p')"
    if [ -n "$dir" ] && [ -f "$dir/scripts/start-atom.sh" ]; then
      echo "$dir"
      return 0
    fi
  fi
  if [ -f "$(dirname "$0")/start-atom.sh" ]; then
    echo "$(cd "$(dirname "$0")/.." && pwd)"
    return 0
  fi
  local found
  found="$(find "$HOME" -maxdepth 4 -path '*/scripts/start-atom.sh' 2>/dev/null | head -1)"
  if [ -n "$found" ]; then
    echo "$(cd "$(dirname "$found")/.." && pwd)"
    return 0
  fi
  return 1
}

echo ""
echo "ATOM GPU fix — Intel Arc / SYCL"
echo "================================"

REPO="$(find_atom_repo)" || REPO=""
if [ -z "$REPO" ]; then
  TARGET="${ATOM_REPO:-$HOME/atom-v2}"
  echo "[fix] ATOM repo not found — cloning to ${TARGET}..."
  if command -v git >/dev/null 2>&1; then
    git clone -b cursor/fix-intel-gpu-setup-dd8d --depth 1 \
      https://github.com/MrBeeboh/Atom-Chat.git "$TARGET" 2>/dev/null \
      || git clone --depth 1 https://github.com/MrBeeboh/Atom-Chat.git "$TARGET"
    REPO="$TARGET"
  else
    echo "ERROR: git not found. Install git or clone manually:"
    echo "  git clone https://github.com/MrBeeboh/Atom-Chat.git ~/atom-v2"
    exit 1
  fi
fi
echo "[fix] Repo: ${REPO}"
cd "$REPO"

if [ ! -f "$REPO/scripts/llama-gpu-common.sh" ]; then
  echo "[fix] Missing GPU scripts — fetching latest..."
  git fetch origin cursor/fix-intel-gpu-setup-dd8d 2>/dev/null || git fetch origin 2>/dev/null || true
  git checkout cursor/fix-intel-gpu-setup-dd8d 2>/dev/null \
    || git merge --ff-only origin/cursor/fix-intel-gpu-setup-dd8d 2>/dev/null \
    || true
fi

if [ ! -f "$REPO/scripts/llama-gpu-common.sh" ]; then
  echo "ERROR: scripts/llama-gpu-common.sh missing. Run:"
  echo "  cd $REPO && git fetch origin && git checkout cursor/fix-intel-gpu-setup-dd8d"
  exit 1
fi

# shellcheck source=scripts/llama-gpu-common.sh
. "$REPO/scripts/llama-gpu-common.sh"

# --- Update repo (best-effort) ---
if [ -d .git ] && command -v git >/dev/null 2>&1; then
  echo "[fix] Updating from GitHub..."
  git fetch origin main cursor/fix-intel-gpu-setup-dd8d 2>/dev/null || git fetch origin 2>/dev/null || true
  if git show-ref --verify --quiet refs/remotes/origin/cursor/fix-intel-gpu-setup-dd8d; then
    if git merge-base --is-ancestor HEAD origin/cursor/fix-intel-gpu-setup-dd8d 2>/dev/null; then
      git merge --ff-only origin/cursor/fix-intel-gpu-setup-dd8d 2>/dev/null \
        && echo "[fix] Updated to GPU-fix branch." \
        || echo "[fix] Could not fast-forward to GPU-fix branch (local changes?)."
    elif [ "$(git rev-parse --abbrev-ref HEAD)" = "cursor/fix-intel-gpu-setup-dd8d" ]; then
      git pull --ff-only origin cursor/fix-intel-gpu-setup-dd8d 2>/dev/null || true
    else
      git merge --ff-only origin/main 2>/dev/null \
        && echo "[fix] Updated to main." \
        || echo "[fix] Could not fast-forward main (local changes?)."
    fi
  else
    git merge --ff-only origin/main 2>/dev/null || true
  fi
  # shellcheck source=scripts/llama-gpu-common.sh
  . "$REPO/scripts/llama-gpu-common.sh"
fi

# --- oneAPI ---
echo "[fix] Loading oneAPI runtime..."
if source_oneapi; then
  echo "[fix] oneAPI OK (${ONEAPI_ROOT:-loaded})"
else
  echo "[fix] WARNING: oneAPI setvars.sh not found."
  echo "       Install Intel oneAPI Base Toolkit, then re-run this script."
fi
export_sycl_runtime_env

# --- Resolve SYCL llama-server ---
LLAMA_BIN="$(resolve_llama_server)"
echo "[fix] llama-server: ${LLAMA_BIN}"

if has_intel_gpu && ! llama_bin_is_sycl "$LLAMA_BIN"; then
  echo "[fix] Searching for llama-server-sycl..."
  for candidate in \
    "$HOME/llama.cpp/build/bin/llama-server" \
    "$HOME/llama.cpp/build-sycl/bin/llama-server" \
    "/usr/local/bin/llama-server-sycl" \
    "/opt/llama.cpp/llama-server-sycl"; do
    if [ -x "$candidate" ] && llama_bin_is_sycl "$candidate"; then
      LLAMA_BIN="$candidate"
      export LLAMA_SERVER_BIN="$candidate"
      echo "[fix] Found SYCL binary: ${LLAMA_BIN}"
      break
    fi
  done
fi

if has_intel_gpu && ! llama_bin_is_sycl "$LLAMA_BIN"; then
  echo ""
  echo "ERROR: No SYCL llama-server found. CPU-only gives ~7-10 tok/s on 27B."
  echo ""
  echo "Build llama.cpp with SYCL:"
  echo "  git clone https://github.com/ggml-org/llama.cpp ~/llama.cpp"
  echo "  cd ~/llama.cpp"
  echo "  source /opt/intel/oneapi/setvars.sh"
  echo "  cmake -B build-sycl -DGGML_SYCL=ON -DCMAKE_C_COMPILER=icx -DCMAKE_CXX_COMPILER=icpx"
  echo "  cmake --build build-sycl -j"
  echo "  export LLAMA_SERVER_BIN=~/llama.cpp/build-sycl/bin/llama-server"
  echo "  bash $REPO/scripts/fix-gpu-setup.sh"
  exit 1
fi

export LLAMA_SERVER_BIN="$LLAMA_BIN"

# --- Kill stale / CPU-only server on 8080 ---
if llama_ready; then
  if llama_server_needs_restart "$LLAMA_BIN" "$REPO/llama-server.log"; then
    stop_llama_on_port "$ATOM_LLAMA_PORT" || true
    sleep 1
  else
    echo "[fix] Existing llama-server on :${ATOM_LLAMA_PORT} looks OK."
  fi
fi

# --- Start SYCL llama-server if not running ---
if ! llama_ready; then
  echo "[fix] Starting SYCL llama-server..."
  export ATOM_RESTART_LLAMA=1
  ATOM_MODELS_DIR="${ATOM_MODELS_DIR:-$HOME/.lmstudio/models}"

  ROUTER=0
  if [ -d "$ATOM_MODELS_DIR" ] && "$LLAMA_BIN" --help 2>&1 | grep -qE 'models-dir'; then
    ROUTER=1
  fi
  ROUTER_EXTRA=()
  if [ "$ROUTER" = 1 ] && "$LLAMA_BIN" --help 2>&1 | grep -qE 'no-models-autoload'; then
    ROUTER_EXTRA=(--no-models-autoload)
  fi

  # shellcheck disable=SC2046
  LLAMA_GPU_ARGS=$(llama_server_common_args)

  {
    echo "===== $(date -Iseconds) fix-gpu-setup launch ====="
    echo "binary=${LLAMA_BIN}"
    echo "args=${LLAMA_GPU_ARGS}"
  } >>"$REPO/llama-server.log"

  if [ "$ROUTER" = 1 ]; then
  # shellcheck disable=SC2086
    nohup "$LLAMA_BIN" --models-dir "$ATOM_MODELS_DIR" --models-max 1 "${ROUTER_EXTRA[@]}" \
      $LLAMA_GPU_ARGS --port "$ATOM_LLAMA_PORT" --host 0.0.0.0 >>"$REPO/llama-server.log" 2>&1 &
  else
    MODEL="$(find "$ATOM_MODELS_DIR" "$HOME/models" -maxdepth 5 -iname '*27b*q4*.gguf' 2>/dev/null | head -1)"
    if [ -z "$MODEL" ]; then
      MODEL="$(find "$ATOM_MODELS_DIR" "$HOME/models" -maxdepth 5 -name '*.gguf' 2>/dev/null | head -1)"
    fi
    if [ -n "$MODEL" ] && [ -f "$MODEL" ]; then
      echo "[fix] Loading model: $MODEL"
      # shellcheck disable=SC2086
      nohup "$LLAMA_BIN" -m "$MODEL" $LLAMA_GPU_ARGS --port "$ATOM_LLAMA_PORT" --host 0.0.0.0 \
        >>"$REPO/llama-server.log" 2>&1 &
    else
      echo "[fix] ERROR: No .gguf model found under $ATOM_MODELS_DIR"
      exit 1
    fi
  fi
  LLAMA_PID=$!
  disown || true

  echo "[fix] Waiting for llama-server (pid ${LLAMA_PID})..."
  for _ in $(seq 1 60); do
    if llama_ready; then
      break
    fi
    if ! kill -0 "$LLAMA_PID" 2>/dev/null; then
      echo "[fix] ERROR: llama-server exited. Last log lines:"
      tail -n 40 "$REPO/llama-server.log"
      exit 1
    fi
    sleep 1
  done
fi

# --- Verify backend ---
sleep 2
echo ""
echo "[fix] Verification:"
if llama_log_shows_sycl "$REPO/llama-server.log"; then
  echo "  ✓ SYCL backend confirmed in llama-server.log"
elif llama_log_shows_cpu_only "$REPO/llama-server.log"; then
  echo "  ✗ CPU-only backend — check oneAPI and LLAMA_SERVER_BIN"
  tail -n 20 "$REPO/llama-server.log"
  exit 1
else
  echo "  ? Could not confirm SYCL — last log lines:"
  tail -n 8 "$REPO/llama-server.log" | sed 's/^/    /'
fi

if llama_ready; then
  echo "  ✓ HTTP server on :${ATOM_LLAMA_PORT}"
else
  echo "  ✗ Server not responding on :${ATOM_LLAMA_PORT}"
  exit 1
fi

# --- Optional quick bench ---
if command -v llama-bench >/dev/null 2>&1; then
  BENCH_MODEL="${GGUF_PATH:-}"
  if [ -z "$BENCH_MODEL" ]; then
    BENCH_MODEL="$(find "${ATOM_MODELS_DIR:-$HOME/.lmstudio/models}" -maxdepth 5 -iname '*27b*q4*.gguf' 2>/dev/null | head -1)"
  fi
  if [ -n "$BENCH_MODEL" ] && [ -f "$BENCH_MODEL" ]; then
    echo ""
    echo "[fix] Quick benchmark ($(basename "$BENCH_MODEL")):"
    llama-bench -m "$BENCH_MODEL" -ngl "$ATOM_LLAMA_NGL" -p 512 -n 128 2>&1 | tail -n 6 | sed 's/^/    /'
  fi
fi

echo ""
if [ -x "$REPO/scripts/check-gpu-setup.sh" ]; then
  bash "$REPO/scripts/check-gpu-setup.sh" || true
fi

echo ""
echo "Done. Start ATOM UI:  cd ${REPO} && npm run start"
echo "Or open the ATOM desktop icon."
