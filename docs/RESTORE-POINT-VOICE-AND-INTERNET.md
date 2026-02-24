# Restore point: Voice + Internet working

**Date:** 2026-02-24  
**State:** Voice (mic) and web search (internet/globe) both work when starting the app with `./scripts/start-atom.sh` or the ATOM desktop icon.

## What this restore point includes

- **Voice server** starts on port 8765 (script launches it; `python-multipart` installed in voice-server venv).
- **Search proxy** starts on port 5174 (script launches `scripts/search-proxy.mjs`).
- **Dev server** runs on port 5175 (or next available).
- Startup script: `scripts/start-atom.sh` starts all three. Desktop launcher runs that script.

## How to return to this state

If you need to roll back to this working state:

```bash
cd /home/mike/atom-chat
git checkout restore-voice-and-internet
# or: git reset --hard restore-voice-and-internet
```

Or find the commit with message `Restore point: voice + internet working` and check it out by hash.

## Quick start from this restore point

```bash
cd /home/mike/atom-chat
./scripts/start-atom.sh
```

Use the browser tab that opens. Mic and globe (web search) should work.
