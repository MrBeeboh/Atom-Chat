# Troubleshooting

Quick checks when something stops working (e.g. after fixing voice or internet).

## Models not loading (llama.cpp / LM Studio)

If the model dropdown is empty or says "Cannot connect":

1. **Start your backend first**  
   - **llama.cpp (recommended on Intel Arc)**: `llama-server -m model.gguf --port 8080 --n-gpu-layers 99`
   - **LM Studio**: Open LM Studio and enable the local server (port 1234).

   The app does *not* start the model server for you. `./scripts/start-atom.sh` only starts the voice server, search proxy, and UI.

2. **Settings → Backend URL**  
   - **Leave empty** → uses `localhost:8080` (llama.cpp).  
   - Change to `http://localhost:1234` for LM Studio.  
   - The URL must point to an **OpenAI-compatible** API (port 8080 or 1234), **not** the voice server (8765) or search proxy (5174).  
   - If this was set to the wrong URL during other fixes, clear it or set it to `http://localhost:1234`.

3. **CORS**  
   If you use a custom URL (e.g. another machine), enable CORS in LM Studio → Developer → Server Settings.

4. **Fallback**  
   The app now retries the default base (localhost:1234 or dev proxy) if the stored URL fails. So if the list still doesn’t load, LM Studio is likely not running or not on port 1234.

## Voice (mic) not working

- Voice server runs on port **8765** (see `voice-server/README.md`).
- Settings → **Voice-to-text server** should be `http://localhost:8765` (or your voice server URL). Do not put the LM Studio URL here.
- Use `./scripts/start-atom.sh` or start the voice server manually so it’s running before using the mic.

## Web search (globe) not working

- Search proxy runs on port **5174** (`scripts/search-proxy.mjs`).  
- `./scripts/start-atom.sh` starts it; plain `npm run dev` does not.

## Port summary

| Service        | Port | Settings key        |
|----------------|------|----------------------|
| LM Studio API  | 1234 | LM Studio server     |
| Voice server   | 8765 | Voice-to-text server |
| Unload helper  | 8766 | Unload helper        |
| Search proxy   | 5174 | (proxied by Vite)    |
| Dev UI         | 5173 or 5175 | —                |

Keeping these straight avoids “fix one thing, break another” when repairing voice or internet.
