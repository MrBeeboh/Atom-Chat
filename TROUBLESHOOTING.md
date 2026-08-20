# Troubleshooting

Quick checks when something stops working (e.g. after fixing voice or internet).

## Models not loading (llama.cpp / LM Studio)

If the model dropdown is empty or says "Cannot connect":

1. **Start your backend first**  
   - **llama.cpp (Intel Arc / Intel GPU)**: use a **SYCL** build (`-DGGML_SYCL=ON` per [llama.cpp SYCL docs](https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/SYCL.md)), then e.g.  
     `source /opt/intel/oneapi/setvars.sh` (Linux) and  
     `llama-server -m /path/to/model.gguf --port 8080 --n-gpu-layers all --flash-attn on --split-mode layer --tensor-split 0.50,0.50 --device SYCL0,SYCL1 --parallel 1`  
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

## Two Arc Pro B70s (llama.cpp SYCL)

On launch, `start-atom.sh` **unloads other apps’ local models** so both cards are free, then uses **both B70s** for ATOM (layer split 50/50 + Flash Attention). The llama-server on port **8080** (and its loaded-model children) is left running.

That ejects:

- LM Studio (`lms unload --all`)
- Ollama (`ollama stop` for each loaded model)
- ComfyUI models (`POST /free` on port 8188, if listening)
- Any other `llama-server` that is **not** the :8080 tree (VL routers, extra `-m` servers, etc.)

**CLI (applied if the binary’s `--help` lists them, when this script starts llama-server)**

| Flag | Why |
|------|-----|
| `--n-gpu-layers all` | Full offload (old `99` can clip deeper models). |
| `--flash-attn on` | Xe2 XMX prefill. Binary default is `auto`. |
| `--split-mode layer --tensor-split 0.50,0.50 --device SYCL0,SYCL1` | Both 32 GB cards for max size. |
| `--parallel 1` | One slot, full KV. Auto was 4 slots on this box. |

`--batch-size 2048` and `--ubatch-size 512` are already llama.cpp defaults. `--jinja` is already on.

**Runtime env (not compile flags)**

- `ONEAPI_DEVICE_SELECTOR=level_zero:gpu` — both cards visible.
- `ZES_ENABLE_SYSMAN=1` — free VRAM reporting (needed for layer split).
- `UR_L0_ENABLE_RELAXED_ALLOCATION_LIMITS=1` — buffers larger than 4 GiB.
- `GGML_SYCL_ENABLE_FLASH_ATTN=1` and `GGML_SYCL_ENABLE_OPT=1`.

`GGML_SYCL_F16` is a **cmake** build option (`-DGGML_SYCL_F16=ON`), not something the launcher can set.

**Overrides**

- `ATOM_SKIP_UNLOAD_OTHERS=1` — do not eject other apps.
- `ATOM_SKIP_B70_FLAGS=1` — old behavior (`--n-gpu-layers 99` only).
- `ATOM_LLAMA_SPLIT=none ATOM_LLAMA_DEVICE=SYCL0` — pin chat to one card.
- `ATOM_LLAMA_SPLIT=tensor` — tensor parallel instead of layer (needs FA; **not** `row`).
- `ATOM_SYCL_FA_ONEDNN=0` — if long-context output is garbage on an older SYCL binary.
- `ATOM_KV_QUANT=1` — `q8_0` KV (more context; helps MKL FA on long prompts ≥1024).
- `ATOM_CTX` (default **0** = this GGUF’s trained max). Do not set `32768`.
- `ATOM_BATCH`, `ATOM_UBATCH`, `ATOM_N_GPU_LAYERS`, `ATOM_LLAMA_PARALLEL`, `ATOM_TENSOR_SPLIT`.

GPU flags only take effect when this script **starts** llama-server. If port 8080 is already up, that process is reused; other apps are still unloaded.

## Voice (mic) not working

- Voice server runs on port **8765** (see `voice-server/README.md`).
- Settings → **Voice-to-text server** should be `http://localhost:8765` (or your voice server URL). Do not put the LM Studio URL here.
- Use `./scripts/start-atom.sh` or start the voice server manually so it’s running before using the mic.
- **“Requested device not found”** means the browser cannot open a microphone:
  - Plug in or enable a mic in your OS sound settings (Input tab).
  - In ATOM **Settings → Connection → Microphone**, pick a different input and click **Refresh**.
  - Close other apps that may be holding the mic (Zoom, Discord, OBS, etc.).
  - Reset the site’s microphone permission in your browser and try again.

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
