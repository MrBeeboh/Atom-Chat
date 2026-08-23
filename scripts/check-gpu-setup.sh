#!/usr/bin/env bash
# Diagnose Intel Arc / SYCL llama.cpp GPU setup for ATOM.
# Run: ./scripts/check-gpu-setup.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/llama-gpu-common.sh
. "$ROOT/scripts/llama-gpu-common.sh"

PASS=0
WARN=0
FAIL=0

ok()   { echo "  ✓ $*"; PASS=$((PASS + 1)); }
warn() { echo "  ! $*"; WARN=$((WARN + 1)); }
bad()  { echo "  ✗ $*"; FAIL=$((FAIL + 1)); }

echo ""
echo "ATOM GPU / SYCL diagnostics"
echo "==========================="
echo ""

echo "1. Intel GPU"
if has_intel_gpu; then
  ok "Intel GPU detected"
  if command -v lspci >/dev/null 2>&1; then
    lspci 2>/dev/null | grep -iE 'vga|3d|display' | grep -i intel | sed 's/^/      /' || true
  fi
else
  warn "No Intel GPU detected (lspci/sysfs). If you have Arc, check drivers."
fi

echo ""
echo "2. oneAPI runtime"
if source_oneapi; then
  ok "oneAPI setvars sourced (${ONEAPI_ROOT:-unknown})"
else
  if has_intel_gpu; then
    bad "oneAPI not found. Install Intel oneAPI Base Toolkit and run: source /opt/intel/oneapi/setvars.sh"
  else
    warn "oneAPI not found (only needed for Intel Arc SYCL builds)"
  fi
fi

echo ""
echo "3. llama-server binary"
LLAMA_BIN="$(resolve_llama_server)"
echo "     Binary: ${LLAMA_BIN}"
if [ ! -x "$LLAMA_BIN" ] && ! command -v "$LLAMA_BIN" >/dev/null 2>&1; then
  bad "llama-server not found or not executable. Build llama.cpp with -DGGML_SYCL=ON or set LLAMA_SERVER_BIN."
else
  if llama_bin_is_sycl "$LLAMA_BIN"; then
    ok "Binary appears SYCL-enabled"
  elif has_intel_gpu; then
    bad "Binary does not look SYCL-enabled. CPU-only builds give ~7-10 tok/s on 27B models."
    echo "      Build: cmake -B build -DGGML_SYCL=ON && cmake --build build"
    echo "      Or set LLAMA_SERVER_BIN to your llama-server-sycl path."
  else
    warn "Binary is not SYCL (OK if you are not on Intel Arc)"
  fi
  if "$LLAMA_BIN" --help 2>&1 | grep -qE 'models-dir'; then
    ok "Router mode supported (--models-dir)"
  else
    warn "Router mode not supported by this binary (older llama.cpp?)"
  fi
fi

echo ""
echo "4. Port ${ATOM_LLAMA_PORT} (llama-server)"
LOGFILE="$ROOT/llama-server.log"
if llama_ready; then
  pid="$(llama_port_pid)"
  cmd="$(llama_cmdline "$pid" 2>/dev/null || true)"
  ok "HTTP server responding on :${ATOM_LLAMA_PORT} (pid ${pid:-?})"
  if [ -n "$cmd" ]; then
    echo "      cmd: ${cmd}"
    if llama_cmdline_has_gpu_offload "$cmd"; then
      ok "Running process has GPU offload flags"
    elif has_intel_gpu; then
      bad "Running process missing -ngl / --n-gpu-layers — likely CPU inference"
      echo "      Fix: ATOM_RESTART_LLAMA=1 ./scripts/start-atom.sh"
    fi
  fi
  if [ -f "$LOGFILE" ]; then
    if llama_log_shows_sycl "$LOGFILE"; then
      ok "llama-server.log shows SYCL / Level Zero backend"
    elif llama_log_shows_cpu_only "$LOGFILE"; then
      bad "llama-server.log shows CPU-only backend"
    else
      warn "Could not confirm SYCL in llama-server.log — check last 30 lines:"
      tail -n 5 "$LOGFILE" 2>/dev/null | sed 's/^/      /' || true
    fi
  fi
else
  warn "No server on :${ATOM_LLAMA_PORT}. Start with: ./scripts/start-atom.sh"
fi

echo ""
echo "5. Model files"
ATOM_MODELS_DIR="${ATOM_MODELS_DIR:-$HOME/.lmstudio/models}"
if [ -d "$ATOM_MODELS_DIR" ]; then
  count="$(find "$ATOM_MODELS_DIR" -maxdepth 5 -name '*.gguf' -type f 2>/dev/null | wc -l | tr -d ' ')"
  ok "Models dir: ${ATOM_MODELS_DIR} (${count} .gguf files)"
  big_q8="$(find "$ATOM_MODELS_DIR" -maxdepth 5 -iname '*27b*q8*.gguf' -o -iname '*27b*Q8*.gguf' 2>/dev/null | head -3)"
  if [ -n "$big_q8" ]; then
    warn "Q8 quants on Arc B70 are slow (~5-15 tok/s). Prefer Q4_K_M for 27B:"
    echo "$big_q8" | sed 's/^/      /'
  fi
  q4_27="$(find "$ATOM_MODELS_DIR" -maxdepth 5 -iname '*27b*q4*.gguf' 2>/dev/null | head -1)"
  if [ -n "$q4_27" ]; then
    ok "Found Q4 27B candidate: $(basename "$q4_27")"
  fi
else
  warn "Models dir not found: ${ATOM_MODELS_DIR}"
fi

echo ""
echo "6. Recommended launch flags (Arc Pro B70)"
echo "     ATOM_LLAMA_CTX=${ATOM_LLAMA_CTX}  ATOM_LLAMA_UBATCH=${ATOM_LLAMA_UBATCH}  ATOM_LLAMA_NGL=${ATOM_LLAMA_NGL}"
echo "     SYCL_CACHE_PERSISTENT=${SYCL_CACHE_PERSISTENT:-0}"
echo "     Expected Qwen3.5-27B Q4_K_M: ~20-22 tok/s with SYCL"

echo ""
echo "7. Optional benchmark"
if [ -n "${GGUF_PATH:-}" ] && [ -f "${GGUF_PATH}" ] && command -v llama-bench >/dev/null 2>&1; then
  echo "     Running llama-bench on ${GGUF_PATH} ..."
  llama-bench -m "$GGUF_PATH" -ngl "$ATOM_LLAMA_NGL" -p 512 -n 128 2>&1 | tail -n 8 | sed 's/^/      /'
elif [ -n "${GGUF_PATH:-}" ] && [ -f "${GGUF_PATH}" ]; then
  warn "Set GGUF_PATH and install llama-bench for a quick throughput test"
else
  echo "     Set GGUF_PATH=/path/to/model.gguf to run llama-bench here"
fi

echo ""
echo "Summary: ${PASS} passed, ${WARN} warnings, ${FAIL} failures"
if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "Quick fix:"
  echo "  ATOM_RESTART_LLAMA=1 LLAMA_SERVER_BIN=\$(which llama-server-sycl) ./scripts/start-atom.sh"
  exit 1
fi
exit 0
