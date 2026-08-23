#!/usr/bin/env bash
# Shared Intel Arc / SYCL helpers for ATOM launchers and diagnostics.
# Source from other scripts: . "$(dirname "$0")/llama-gpu-common.sh"

_llama_gpu_common_loaded=1

ATOM_LLAMA_PORT="${ATOM_LLAMA_PORT:-8080}"
ATOM_LLAMA_CTX="${ATOM_LLAMA_CTX:-8192}"
ATOM_LLAMA_UBATCH="${ATOM_LLAMA_UBATCH:-2048}"
ATOM_LLAMA_NGL="${ATOM_LLAMA_NGL:-99}"

source_oneapi() {
  if [ -n "${ATOM_SKIP_ONEAPI:-}" ] || [ -n "${ONEAPI_ROOT:-}" ]; then
    return 0
  fi
  for _setvars in /opt/intel/oneapi/setvars.sh "$HOME/intel/oneapi/setvars.sh"; do
    if [ -f "$_setvars" ]; then
      set +e
      # shellcheck source=/dev/null
      . "$_setvars" >/dev/null 2>&1
      set -e
      return 0
    fi
  done
  return 1
}

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

llama_bin_is_sycl() {
  local bin="$1"
  [ -n "$bin" ] || return 1
  if echo "$bin" | grep -qi sycl; then
    return 0
  fi
  if [ -x "$bin" ]; then
    if "$bin" --version 2>&1 | grep -qiE 'sycl|level zero|oneapi'; then
      return 0
    fi
    if ldd "$bin" 2>/dev/null | grep -qiE 'sycl|ze_loader|level-zero'; then
      return 0
    fi
    if strings "$bin" 2>/dev/null | grep -q GGML_SYCL; then
      return 0
    fi
  fi
  return 1
}

has_intel_gpu() {
  if command -v lspci >/dev/null 2>&1; then
    lspci 2>/dev/null | grep -qiE 'vga|3d|display' && lspci 2>/dev/null | grep -qiE 'intel|arc' && return 0
  fi
  for _drm in /sys/class/drm/card*/device/vendor; do
    [ -f "$_drm" ] || continue
    if grep -qi 0x8086 "$_drm" 2>/dev/null; then
      return 0
    fi
  done
  return 1
}

llama_port_pid() {
  local port="${1:-$ATOM_LLAMA_PORT}"
  if command -v fuser >/dev/null 2>&1; then
    fuser -n tcp "$port" 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+$' | head -1
    return
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -tlnp 2>/dev/null | grep ":${port} " | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1
    return
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti ":${port}" -sTCP:LISTEN 2>/dev/null | head -1
  fi
}

llama_cmdline() {
  local pid="$1"
  [ -n "$pid" ] || return 1
  if [ -r "/proc/${pid}/cmdline" ]; then
    tr '\0' ' ' <"/proc/${pid}/cmdline"
    return 0
  fi
  if command -v ps >/dev/null 2>&1; then
    ps -p "$pid" -o args= 2>/dev/null
  fi
}

llama_cmdline_has_gpu_offload() {
  local cmd="$1"
  echo "$cmd" | grep -qiE '(^|[[:space:]])(-ngl|--n-gpu-layers|--gpu-layers)(=|[[:space:]])[0-9]+' \
    || echo "$cmd" | grep -qiE '(^|[[:space:]])(-ngl|--n-gpu-layers|--gpu-layers)(=|[[:space:]])(all|auto)' \
    || echo "$cmd" | grep -qiE '(^|[[:space:]])(-ngl|--n-gpu-layers|--gpu-layers)(=|[[:space:]])'
}

llama_log_shows_sycl() {
  local logfile="$1"
  [ -f "$logfile" ] || return 1
  grep -qiE 'sycl|level zero|oneapi|ggml_sycl|intel.*gpu' "$logfile" 2>/dev/null
}

llama_log_shows_cpu_only() {
  local logfile="$1"
  [ -f "$logfile" ] || return 1
  if llama_log_shows_sycl "$logfile"; then
    return 1
  fi
  grep -qiE 'cpu backend|using cpu|no usable gpu|ggml_backend_cpu' "$logfile" 2>/dev/null
}

llama_ready() {
  local port="${1:-$ATOM_LLAMA_PORT}"
  curl -sS --max-time 3 "http://127.0.0.1:${port}/v1/models" >/dev/null 2>&1 \
    || curl -sS --max-time 3 "http://127.0.0.1:${port}/models" >/dev/null 2>&1
}

# Returns 0 when an existing :8080 server looks CPU-only or missing GPU offload flags.
llama_server_needs_restart() {
  local expected_bin="$1"
  local logfile="$2"
  local pid cmd

  if [ -n "${ATOM_RESTART_LLAMA:-}" ]; then
    return 0
  fi

  pid="$(llama_port_pid)"
  [ -n "$pid" ] || return 1

  cmd="$(llama_cmdline "$pid")"
  if ! echo "$cmd" | grep -qiE 'llama-server|llama_server'; then
    # Port owned by LM Studio or another app — don't kill it.
    return 1
  fi

  if has_intel_gpu && llama_bin_is_sycl "$expected_bin"; then
    if ! llama_cmdline_has_gpu_offload "$cmd"; then
      echo "[ATOM] Existing llama-server on :${ATOM_LLAMA_PORT} has no GPU offload flags (-ngl / --n-gpu-layers)." >&2
      return 0
    fi
    if ! llama_bin_is_sycl "$cmd" && ! llama_log_shows_sycl "$logfile"; then
      echo "[ATOM] Existing llama-server on :${ATOM_LLAMA_PORT} does not look like a SYCL build." >&2
      return 0
    fi
    if llama_log_shows_cpu_only "$logfile"; then
      echo "[ATOM] llama-server.log indicates CPU-only backend." >&2
      return 0
    fi
  fi

  return 1
}

stop_llama_on_port() {
  local port="${1:-$ATOM_LLAMA_PORT}"
  local pid
  pid="$(llama_port_pid "$port")"
  [ -n "$pid" ] || return 0
  local cmd
  cmd="$(llama_cmdline "$pid")"
  if ! echo "$cmd" | grep -qiE 'llama-server|llama_server'; then
    echo "[ATOM] Port ${port} is in use by another process (pid ${pid}); not stopping it." >&2
    return 1
  fi
  echo "[ATOM] Stopping llama-server on :${port} (pid ${pid})..."
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.25
  done
  kill -9 "$pid" 2>/dev/null || true
}

export_sycl_runtime_env() {
  # Prevent known B70 SYCL cache segfaults with dynamically loaded ggml-sycl.
  export SYCL_CACHE_PERSISTENT="${SYCL_CACHE_PERSISTENT:-0}"
  export GGML_SYCL_DISABLE_OPT="${GGML_SYCL_DISABLE_OPT:-0}"
  if has_intel_gpu; then
    export ZE_AFFINITY_MASK="${ZE_AFFINITY_MASK:-0}"
  fi
}

llama_server_common_args() {
  # shellcheck disable=SC2086
  echo --n-gpu-layers "$ATOM_LLAMA_NGL" -ngl "$ATOM_LLAMA_NGL" -c "$ATOM_LLAMA_CTX" -ub "$ATOM_LLAMA_UBATCH"
}
