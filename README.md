# ATOM Chat

A local-first AI chat and model evaluation tool. Compare models head-to-head in the Arena, generate images, search the web — all from your machine. No cloud required.

## Quick start

```bash
./setup.sh        # install deps, build, detect LM Studio, create desktop launcher
npm run dev       # start dev server at http://localhost:5173
```

That's it. Pick a model, start a chat.

## What you need

- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- **llama.cpp** — `llama-server` on `localhost:8080` (default in Settings). **Intel Arc / Intel GPU:** use a [SYCL-enabled build](https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/SYCL.md) (`GGML_SYCL`); the UI only talks HTTP and does not pick the GPU backend. `./scripts/start-atom.sh` prefers `llama-server-sycl` on your `PATH`, or set `LLAMA_SERVER_BIN`. Dual Arc Pro B70: both cards (layer split); other local models are unloaded on launch — see `TROUBLESHOOTING.md`.
- Any OpenAI-compatible server (LM Studio, Ollama, etc.) also works if you change the URL in Settings.

Optional: Python 3 for voice input, hardware metrics, and model unloading helpers.

## Features

- Streaming chat with Markdown + code highlighting
- **ATOM Arena** — head-to-head model comparison with automated judging, score matrix, blind review
- 15+ image generation engines (FLUX, Seedream, Wan, Grok, SDXL)
- Web search integration (Brave API or DuckDuckGo proxy)
- Vision support — paste or drop images/PDFs/video
- Model optimization — fetch recommended settings from Hugging Face
- Cloud API support — Nous, DeepSeek, Grok, Cerebras, DeepInfra
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
| `npm run start` | Full stack — voice server + search proxy + UI |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Serve production build locally |
| `./setup.sh` | Install deps, build, detect LM Studio |

## Staying up to date

The launchers (`npm run start`, `./start-atom.sh`, desktop icon) auto-sync from
GitHub on every start: they fast-forward to the latest `origin/main` and re-run
`npm install` only when dependencies changed. Sync is skipped safely when you
are offline, have local edits, or are on a different branch.

- `ATOM_SKIP_SYNC=1` — disable auto-sync for one launch (or export it permanently)
- `ATOM_SYNC_BRANCH=mybranch` — track a branch other than `main`

## Settings

The **Settings panel** (`Ctrl+,`) controls:
- Model defaults (temperature, max tokens, top-p, top-k, penalties)
- Cloud API keys (Nous, DeepSeek, Grok, Cerebras, DeepInfra)
- Voice server URL
- Web search (Brave API key or local proxy)
- Theme (Studio / Pitch Black / Light)
- Desktop files: Documents read/write, plus allowlisted OpenSCAD / slice jobs

## Desktop files and print jobs

ATOM talks to a local host on this machine only (`127.0.0.1`). It can list, read, and write **text** under `~/Documents`. Writes need one approval per launch.

There is **no shell**. 3D-print actions are named jobs:

- `export_scad` — OpenSCAD → STL under Documents
- `slice_print` — `~/Documents/3d_Printing/PRINTS/slice_print.py` (OrcaSlicer + Moonraker upload). Always **stages**; never starts
- `start_print` — starts a staged gcode. The UI asks **every time** (heaters / motion)

Optional env: `ATOM_OPENSCAD`, `ATOM_PYTHON`, `ATOM_MOONRAKER_URL` (default `http://192.168.0.18:7125`).

## Arena

Switch to Arena layout to compare up to 4 models. Load a question set, click **Run All**, and the judge model scores every response. Export results as JSON or CSV.

## Tech

**Svelte 5** + **Vite** + **Tailwind CSS v4** — fully static, no backend. Dexie.js for IndexedDB, marked + highlight.js for rendering.

## Release

Download the latest `atom-chat.zip` from [Releases](https://github.com/anomalyco/atom-chat/releases). Extract and open `dist/index.html`, or serve with `npx serve dist`.
