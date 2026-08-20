# AGENTS.md

## Cursor Cloud specific instructions

ATOM Chat is a **fully static Svelte 5 + Vite frontend** (no backend of its own). The
core product is the chat/Arena UI. It talks to an external **OpenAI-compatible LLM
server** (llama.cpp `llama-server` or LM Studio) that is *not* part of this repo.

### Services

| Service | Command | Port | Required | Notes |
|---|---|---|---|---|
| Frontend (Vite dev) | `npm run dev` | 5173 | Yes | The product. Listens on `0.0.0.0`. |
| LLM backend | external (llama.cpp / LM Studio) | 8080 | For real chat | Not in this repo. Dev server proxies `/api/llama` → `http://localhost:8080`. See below for testing without a real model. |
| Search proxy | `node scripts/search-proxy.mjs` | 5174 | Optional | Web search; needs `BRAVE_API_KEY` env or a key set in Settings. |
| Voice server | `cd voice-server && python3 -m uvicorn app:app --port 8765` | 8765 | Optional | Whisper (heavy Python/transformers deps, not installed by default). |
| Hardware metrics | `python3 scripts/hardware_server.py` | 5000 | Optional | Floating CPU/GPU panel. |

### Standard commands (see `package.json`)

- Lint: `npm run lint` — **exits non-zero**: the repo ships ~158 pre-existing lint findings (documented in `SETUP-TOOLING.md`). A clean run is not expected; treat only *new* findings in files you touch as actionable.
- Test: `npm run test:run` (Vitest, once) or `npm run test` (watch). Config in `vitest.config.js` (node env, no Svelte plugin — JS unit tests only).
- Build: `npm run build` → `dist/` (warnings about chunk size / a11y are expected).
- Dev: `npm run dev` (port 5173).

### Gotchas

- **Dependency install requires `--legacy-peer-deps`.** `eslint-config-standard@16` (a leftover dep) peer-requires `eslint@^7` while the project uses `eslint@^9`, so a plain `npm install` fails with ERESOLVE. Use `npm install --legacy-peer-deps`. The flat ESLint config (`eslint.config.js`) does not actually use `eslint-config-standard`.
- **Do NOT use `npm run start` in cloud.** That launcher (`scripts/start-atom.sh`) auto-`git fetch`/fast-forwards `origin/main`, tries to source Intel oneAPI, and spawns a local `llama-server` from GGUF files on disk. Use `npm run dev` instead.
- **Testing chat end-to-end without a GPU/model:** point the app at any OpenAI-compatible server on `localhost:8080`. A minimal mock only needs `GET /models` (returns a model list) and `POST /v1/chat/completions` (supports `stream: true` SSE). The dev proxy forwards `/api/llama/*` to it, the app auto-detects the model, and streaming chat works. Backend URL/keys are overridable in Settings (`Ctrl+,`) and stored in `localStorage` per origin.
