#!/usr/bin/env bash
# Compatibility wrapper — full stack is the same launcher as ./start-atom.sh
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$ROOT/scripts/start-atom.sh" "$@"
