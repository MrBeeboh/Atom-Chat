# Troubleshooting

Quick checks when something stops working (e.g. after fixing voice or internet).

## App won't start / browser never opens / window flashes red (Linux Mint)

This is the desktop launcher, not the Svelte app itself. Symptoms: a terminal
pops up, maybe a flash of red (`llama-server: command not found`), then
everything closes and no browser tab appears.

**Start from the repo folder:**

```bash
cd ~/atom-chat          # or wherever you cloned Atom Chat
./start-atom.sh
# or
npm run start
```

`llama-server` is **optional**. ATOM talks to LM Studio on port 1234 (or any
OpenAI-compatible URL in Settings). A missing llama binary must not abort launch.

**If the window still closes immediately:**

1. Open `atom-start.log` in the repo folder — the last launch is appended there.
2. Confirm Node is on PATH: `node -v` (need 18+).
3. Reinstall deps: `npm install`
4. Diagnostic (does not start servers): `./start-atom.sh --check`

**Desktop icon points at the wrong folder** (old copies used `/home/mike/atom-v2`):

```bash
cd ~/atom-chat && ./setup.sh
```

That rewrites `~/.local/share/applications/ATOM.desktop` and `~/Desktop/ATOM.desktop`
to this repo, and installs an `atom` command in `~/.local/bin`.

**Port already in use:**

```bash
ATOM_CLEAN_PORTS=1 ./start-atom.sh
# or
ATOM_UI_PORT=5175 ./start-atom.sh
```

**Browser doesn't open:** the URL is printed (`http://localhost:5173/`). Open it
manually. `echo $DISPLAY` should not be empty in a graphical session.

## Models not loading (llama.cpp / LM Studio)

If the model dropdown is empty or says "Cannot connect":

1. **Start your backend first**  
   - **llama.cpp (Intel Arc / Intel GPU)**: use a **SYCL** build (`-DGGML_SYCL=ON` per [llama.cpp SYCL docs](https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/SYCL.md)), then e.g.  
     `source /opt/intel/oneapi/setvars.sh` (Linux) and  
     `llama-server -m /path/to/model.gguf --port 8080 --n-gpu-layers 99`  
     A generic `llama-server` from a CUDA-only build will **not** use your Arc GPU; tokens/sec will stay low.  
   - **`./scripts/start-atom.sh`** picks `llama-server-sycl` if it is on your `PATH`, otherwise `llama-server`. Override with **`LLAMA_SERVER_BIN=/full/path/to/llama-server`**.  
   - **LM Studio**: enable the local server (often port 1234) and point ATOM there if you prefer.

   The UI does not choose CUDA vs SYCL; only the **binary and environment** you run matter. ATOM just sends HTTP to **Settings → Backend URL** (default `http://localhost:8080`).

2. **Verify GPU path (SYCL)**  
   - Watch **`llama-server.log`** after starting from our script (first lines often show backend / device).  
   - Ensure **oneAPI** / Level Zero drivers match your GPU (Arc Pro B-series needs a current stack).  
   - If something is already listening on 8080, ATOM reuses it: that process might be an **old CPU-only** server — stop it and start your SYCL `llama-server` first.

3. **Settings → Backend URL**  
   - **Leave empty** → uses `localhost:8080` (llama.cpp).  
   - Change to `http://localhost:1234` for LM Studio.  
   - The URL must point to an **OpenAI-compatible** API (8080 or 1234), **not** the voice server (8765) or search proxy (5174).

4. **CORS**  
   If you use a custom URL (e.g. another machine), enable CORS in LM Studio → Developer → Server Settings.

5. **Still no models**  
   If the list still does not load, the server at that URL is likely down or not OpenAI-compatible.

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
