# ATOM Chat

A local-first AI chat and model evaluation tool. Compare models head-to-head in the Arena, generate images, search the web — all from your machine. No cloud required.

## Quick start

```bash
./setup.sh        # install deps, build, detect LM Studio, create desktop launcher
./start-atom.sh   # full stack — keeps the terminal open, opens the browser
```

Or `npm run dev` for the UI only. Pick a model, start a chat.

## What you need

- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- An OpenAI-compatible server: **LM Studio** (`localhost:1234`) is the usual setup. Set the URL in Settings if it is not already there.
- **llama.cpp** is optional (`llama-server` on `localhost:8080`). The launcher starts it only if the binary is on your `PATH`. **Intel Arc:** use a [SYCL-enabled build](https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/SYCL.md) or set `LLAMA_SERVER_BIN`.

Optional: Python 3 for voice input, hardware metrics, and model unloading helpers.

## Features

- Streaming chat with Markdown + code highlighting
- **ATOM Arena** — head-to-head model comparison with automated judging, score matrix, blind review
- 15+ image generation engines (FLUX, Seedream, Wan, Grok, SDXL)
- Web search integration (Brave API or DuckDuckGo proxy)
- Vision support — paste or drop images/PDFs/video
- Model optimization — fetch recommended settings from Hugging Face
- Cloud API support — DeepSeek, Grok, Cerebras, DeepInfra
- Voice input (Whisper via local Python server)
- Message tools — regenerate, edit & resend, copy, pin, per-message delete
- Conversation history (IndexedDB + pin, inline rename, bulk erase)
- Deep search — find chats by message content, with snippet previews
- Dark / light / system theme
- 44-key shortcut palette (`Ctrl+K`)

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server (no voice/search) |
| `npm run start` / `./start-atom.sh` | Full stack — voice, search, UI; holds the terminal on error |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Serve production build locally |
| `./setup.sh` | Install deps, build, detect LM Studio |

## Staying up to date

The launchers (`npm run start`, `./start-atom.sh`, desktop icon) check **Origin**
(`origin/main`) on start. They only *report* new commits — they do not merge or
overwrite your tree. `npm install` runs automatically if `node_modules` is missing.

- `ATOM_SKIP_SYNC=1` — skip the Origin check
- `ATOM_SYNC_BRANCH=mybranch` — check a branch other than `main`
- `ATOM_CLEAN_PORTS=1` — kill a stale Vite / voice / search process and retry
- `ATOM_UI_PORT=5175` — bind a specific UI port
- `ATOM_START_LLAMA=0` — never try to start llama-server (LM Studio is enough)

If the desktop window flashes red and closes, read `atom-start.log` in the repo
folder. The launcher keeps the terminal open so the error stays readable.

## Settings

The **Settings panel** (`Ctrl+,`) controls:
- Model defaults (temperature, max tokens, top-p, top-k, penalties)
- Cloud API keys (DeepSeek, Grok, Cerebras, DeepInfra)
- Voice server URL
- Web search (Brave API key or local proxy)
- Theme (Studio / Pitch Black / Light)

## Arena

Switch to Arena layout to compare up to 4 models. Load a question set, click **Run All**, and the judge model scores every response. Export results as JSON or CSV.

## Tech

**Svelte 5** + **Vite** + **Tailwind CSS v4** — fully static, no backend. Dexie.js for IndexedDB, marked + highlight.js for rendering.

## Release

Download the latest `atom-chat.zip` from [Releases](https://github.com/anomalyco/atom-chat/releases). Extract and open `dist/index.html`, or serve with `npx serve dist`.
