# ATOM

A minimal, information-dense chat frontend for local AI. Connects to any OpenAI-compatible API (e.g. [LM Studio](https://lmstudio.ai/))’—no backend required.

## Requirements

- A model server (e.g. **LM Studio**) running with at least one model loaded
- API server enabled (default: **http://localhost:1234**)

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173. Choose a model from the dropdown, start a new chat, and send messages.

## Build

```bash
npm run build
```

Output is in `dist/`. Serve with any static host or open `dist/index.html` locally (conversations are stored in IndexedDB in the browser).

## Features

- Chat with streaming responses
- Model switching (uses models loaded in your server)
- **Optimize**: fetch recommended settings from Hugging Face (or Ollama registry); optional AI fallback
- **Intel panel**: system prompt, parameters (temperature, top_p, top_k, context), load settings, Save to LM Studio
- Chat history stored in the browser (IndexedDB)
- Markdown and code highlighting in replies
- Image attachments for vision-capable models
- Performance stats (tokens/sec, latency)
- Dark / light / system theme
- Settings: temperature, max tokens, system prompt

## Tech

- **Svelte 5** + **Vite** + **Tailwind CSS**
- **Dexie.js** for IndexedDB
- **marked** + **highlight.js** for markdown
