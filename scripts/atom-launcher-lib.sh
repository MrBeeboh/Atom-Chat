# Shared helpers for ATOM Chat launchers (sourced by start-atom.sh).
# shellcheck shell=bash

atom_log() {
  local msg="$1"
  printf '%s\n' "$msg"
  if [ -n "${ATOM_LOG:-}" ]; then
    printf '%s\n' "$msg" >>"$ATOM_LOG"
  fi
}

atom_port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | grep -qE ":${port}[[:space:]]"
    return $?
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -Pi :"$port" -sTCP:LISTEN -t >/dev/null 2>&1
    return $?
  fi
  if command -v fuser >/dev/null 2>&1; then
    fuser "${port}/tcp" >/dev/null 2>&1
    return $?
  fi
  curl -s --max-time 1 "http://127.0.0.1:${port}/" >/dev/null 2>&1
}

atom_http_ok() {
  local url="$1"
  curl -sS --max-time 2 -o /dev/null "$url" >/dev/null 2>&1
}

atom_wait_for_http() {
  local url="$1"
  local attempts="${2:-60}"
  local sleep_s="${3:-0.5}"
  local i
  for ((i = 1; i <= attempts; i++)); do
    if atom_http_ok "$url"; then
      return 0
    fi
    sleep "$sleep_s"
  done
  return 1
}

atom_pick_ui_port() {
  local preferred="${ATOM_UI_PORT:-}"
  local try
  if [ -n "$preferred" ]; then
    printf '%s' "$preferred"
    return 0
  fi
  for try in 5173 5175 5176 5177; do
    if ! atom_port_in_use "$try"; then
      printf '%s' "$try"
      return 0
    fi
  done
  printf '%s' "5173"
}

atom_open_browser() {
  local url="$1"

  if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
    atom_log "[ATOM] No graphical session (DISPLAY unset). Open manually: $url"
    return 1
  fi

  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 &
    disown 2>/dev/null || true
    return 0
  fi

  local opener
  for opener in sensible-browser x-www-browser firefox chromium chromium-browser google-chrome brave-browser; do
    if command -v "$opener" >/dev/null 2>&1; then
      "$opener" "$url" >/dev/null 2>&1 &
      disown 2>/dev/null || true
      return 0
    fi
  done

  if command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1 &
    return 0
  fi

  return 1
}

atom_open_browser_when_ready() {
  local port="$1"
  local url="http://localhost:${port}/"
  if atom_wait_for_http "$url" 80 0.5; then
    atom_log "[ATOM] UI ready: ${url}"
    if atom_open_browser "$url"; then
      atom_log "[ATOM] Opening browser..."
    else
      atom_log "[ATOM] Could not auto-open a browser. Open this URL: ${url}"
    fi
    return 0
  fi
  atom_log "[ATOM] UI is slow to start. When Vite is ready, open: ${url}"
  return 1
}

atom_resolve_llama_bin() {
  if [ -n "${LLAMA_SERVER_BIN:-}" ]; then
    if [ -x "${LLAMA_SERVER_BIN}" ]; then
      printf '%s' "${LLAMA_SERVER_BIN}"
      return 0
    fi
    if command -v "${LLAMA_SERVER_BIN}" >/dev/null 2>&1; then
      command -v "${LLAMA_SERVER_BIN}"
      return 0
    fi
    return 1
  fi
  if command -v llama-server-sycl >/dev/null 2>&1; then
    command -v llama-server-sycl
    return 0
  fi
  if command -v llama-server >/dev/null 2>&1; then
    command -v llama-server
    return 0
  fi
  return 1
}

atom_clean_ports() {
  local port
  atom_log "[ATOM] Clearing stuck ATOM ports (ATOM_CLEAN_PORTS=1)..."
  pkill -f "node.*search-proxy.mjs" 2>/dev/null || true
  pkill -f "vite" 2>/dev/null || true
  pkill -f "python.*voice-server" 2>/dev/null || true
  pkill -f "uvicorn app:app" 2>/dev/null || true
  for port in 5173 5174 5175 5176 5177 8765; do
    if command -v lsof >/dev/null 2>&1; then
      local pids
      pids="$(lsof -ti :"$port" 2>/dev/null || true)"
      [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
    elif command -v fuser >/dev/null 2>&1; then
      fuser -k "${port}/tcp" >/dev/null 2>&1 || true
    fi
  done
  sleep 1
}
