# Agent notes — Atom Chat (NOT Atom Code)

## Repos (do not confuse)

| Project | Origin repo | Purpose |
|---------|-------------|---------|
| **Atom Chat** | `MrBeeboh/Atom-Chat` | LM Studio chat UI, Arena, voice — **this repo** |
| Atom Code | `MrBeeboh/Atom-Code` | Vibe code assistant — **different project** |

## Git host

- **Source of truth:** Cursor **Origin** (`https://origin.cursor.com/MrBeeboh/Atom-Chat.git`)
- **Not GitHub.** Do not reference GitHub URLs or tell the user to push/pull from GitHub for Atom Chat.
- The git remote is named `origin` (standard git); that is not the same word as the Origin product.

## User machine

- **OS:** Linux Mint (`HAL2026`)
- **Repo path:** `/home/mike/atom-chat`
- **Launch:** `cd ~/atom-chat && ./scripts/start-atom.sh` or the ATOM Chat desktop menu entry

## Cloud agent environment

If the agent sidebar shows `github.com/MrBeeboh/Atom-Chat`, the Cursor Cloud environment is still linked to GitHub. Re-link it to Origin in Cursor → Cloud Agents → Environments → Atom Chat → change repository to Origin.
