# Agent notes — Atom Chat (NOT Atom Code)

## Repos (do not confuse)

| Project | Origin repo | Purpose |
|---------|-------------|---------|
| **Atom Chat** | `MrBeeboh/Atom-Chat` | LM Studio chat UI, Arena, voice — **this repo** |
| Atom Code | `MrBeeboh/Atom-Code` | Vibe code assistant — **different project** |

## Git host

- **Source of truth:** Cursor **Origin** (`https://origin.cursor.com/MrBeeboh/Atom-Chat.git`)
- Do not tell the user to push/pull Atom Chat from GitHub.
- The git remote is named `origin` (standard git). That is not the same word as the Origin product.

## User machine

- **OS:** Linux Mint (`HAL2026`)
- **Typical repo path:** `/home/mike/atom-chat` (also seen as `atom-v2` — do not hardcode either)
- **Launch:** `cd <repo> && ./start-atom.sh` or the **ATOM Chat** desktop/menu entry
- **Model backend:** LM Studio on `localhost:1234`. `llama-server` is optional.

## Launcher rules (do not regress)

The desktop icon runs `scripts/start-atom.sh` in a terminal. Past breakages:

1. `set -e` plus `"${LLAMA_BIN}" --help` when llama-server is not installed → red `command not found` → window closes before Vite starts.
2. `ATOM.desktop` hardcoded `/home/mike/atom-v2` while `setup.sh` only rewrote `/home/mike/atom-chat`.
3. Vite started in the background so the `.desktop` `Terminal=true` session exited immediately.
4. Auto-sync `git merge --ff-only` on every launch.

Current contract:

- No `set -e` in the launcher.
- Never invoke a binary that is not on PATH.
- Vite stays in the foreground.
- On failure, print the error, write `atom-start.log`, and `hold` (Enter / 12s).
- `setup.sh` substitutes `__ATOM_ROOT__` in `ATOM.desktop` with the real repo path.
- Origin check is fetch-only; it never merges and never aborts launch.

## Cloud agent environment

If the agent sidebar shows `github.com/MrBeeboh/Atom-Chat`, the Cursor Cloud
environment is still linked to GitHub. Re-link it to Origin in Cursor → Cloud
Agents → Environments.
