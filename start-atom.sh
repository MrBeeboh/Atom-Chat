#!/usr/bin/env bash
# Same launcher as the desktop icon (scripts/start-atom.sh).
# Safe to run from the repo root: ./start-atom.sh
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$ROOT/scripts/start-atom.sh" "$@"
