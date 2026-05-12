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
- **llama.cpp** — `llama-server` on `localhost:8080` (default in Settings). **Intel Arc / Intel GPU:** use a [SYCL-enabled build](https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/SYCL.md) (`GGML_SYCL`); the UI only talks HTTP and does not pick the GPU backend. `./scripts/start-atom.sh` prefers `llama-server-sycl` on your `PATH`, or set `LLAMA_SERVER_BIN`.
- Any OpenAI-compatible server (LM Studio, Ollama, etc.) also works if you change the URL in Settings.

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
- Conversation history (IndexedDB + bulk erase)
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
