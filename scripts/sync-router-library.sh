#!/usr/bin/env bash
# Do NOT auto-symlink every GGUF under ~/.lmstudio or ~/models into the router dir.
# That put TTS, MTP, and deleted junk back into Atom Chat's dropdown.
# Library (~/models/library) is now the curated list. This script only reports it.
set -euo pipefail

LIB="${ATOM_MODELS_DIR:-$HOME/models/library}"
mkdir -p "$LIB"
echo "[sync] library=$LIB (curated; not auto-filling from hub/tts)"
find "$LIB" -maxdepth 1 \( -name '*.gguf' -o -type d ! -name '.' ! -name '..' \) -printf '%f\n' 2>/dev/null | sort
