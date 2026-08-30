# Shared helpers for ATOM launchers (sourced by start-atom.sh scripts).
# shellcheck shell=bash

atom_open_browser() {
  local url="$1"

  if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
    echo "[ATOM] No graphical session detected (DISPLAY unset). Open manually: $url"
    return 1
  fi

  if command -v xdg-open >/dev/null 2>&1; then
    if xdg-open "$url" >/dev/null 2>&1 & then
      disown 2>/dev/null || true
      return 0
    fi
  fi

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

  case "${OSTYPE:-}" in
    msys*|cygwin*|mingw*)
      if command -v cmd.exe >/dev/null 2>&1; then
        cmd.exe /c start "" "$url" >/dev/null 2>&1 &
        return 0
      fi
      ;;
  esac

  return 1
}

atom_wait_for_http() {
  local url="$1"
  local attempts="${2:-40}"
  local sleep_s="${3:-0.5}"
  local i
  for ((i = 1; i <= attempts; i++)); do
    if curl -s --max-time 1 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$sleep_s"
  done
  return 1
}

atom_port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -Pi :"$port" -sTCP:LISTEN -t >/dev/null 2>&1
    return $?
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "( sport = :$port )" 2>/dev/null | grep -q LISTEN
    return $?
  fi
  curl -s --max-time 1 "http://127.0.0.1:${port}/" >/dev/null 2>&1
}

atom_launch_url() {
  local port="$1"
  local url="http://localhost:${port}/"
  echo ""
  echo "✓ ATOM UI running: ${url}"
  if atom_open_browser "$url"; then
    echo "Opening browser..."
  else
    echo "Could not auto-open a browser."
    echo "Open this URL manually: ${url}"
  fi
}

atom_open_browser_when_ready() {
  local port="$1"
  local url="http://localhost:${port}/"
  if atom_wait_for_http "$url" 60 0.5; then
    atom_launch_url "$port"
  else
    echo "[ATOM] UI is slow to start. When Vite is ready, open: ${url}"
  fi
}
