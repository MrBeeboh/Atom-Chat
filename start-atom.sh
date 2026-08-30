#!/bin/bash
# Same launcher as the desktop icon (scripts/start-atom.sh).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$ROOT/scripts/start-atom.sh"
