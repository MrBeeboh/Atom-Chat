# Troubleshooting

Quick checks when something stops working (e.g. after fixing voice or internet).

## Models not loading (llama.cpp / LM Studio)

If the model dropdown is empty or says "Cannot connect":

1. **Start your backend first**  
   - **llama.cpp (Intel Arc / Intel GPU)**: use a **SYCL** build (`-DGGML_SYCL=ON` per [llama.cpp SYCL docs](https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/SYCL.md)), then e.g.  
     `source /opt/intel/oneapi/setvars.sh` (Linux) and  
     `llama-server -m /path/to/model.gguf --port 8080 --n-gpu-layers all --flash-attn on --split-mode none --device SYCL1 --parallel 1`  
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

On launch, `start-atom.sh` **unloads other apps’ local models** so both cards are free. The systemd router on **:8080** keeps **both** B70s visible, then places models like this:

- **Single-card models** (everything that fits one 32 GB card, including Muse Glimmer) load on the **second GPU** (`SYCL1`). The desktop card stays free for Cinnamon / ComfyUI.
- **Large models** (Qwen 80B, ~45 GB) **layer-split** across `SYCL0,SYCL1` via `~/.config/llama/models-preset.ini`.

Do not pin `ONEAPI_DEVICE_SELECTOR=level_zero:1` on the router service. That hides GPU 0 and makes the 80B impossible.

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
| `--split-mode none --device SYCL1` | Default. One model on the second B70. |
| `--split-mode layer --tensor-split 0.45,0.55 --device SYCL0,SYCL1` | 80B only (models-preset). Bias weight toward the second card. |
| `--parallel 1` | One slot, full KV. Auto was 4 slots on this box. |

`--batch-size 2048` and `--ubatch-size 512` are already llama.cpp defaults. `--jinja` is already on.

**Runtime env (not compile flags)**

- `ONEAPI_DEVICE_SELECTOR=level_zero:0,1` — both cards visible (`0,1`, not `gpu` and not a single index).
- `ZES_ENABLE_SYSMAN=1` — free VRAM reporting (needed for layer split).
- `UR_L0_ENABLE_RELAXED_ALLOCATION_LIMITS=1` — buffers larger than 4 GiB.
- `GGML_SYCL_ENABLE_FLASH_ATTN=1` and `GGML_SYCL_ENABLE_OPT=1`.

`GGML_SYCL_F16` is a **cmake** build option (`-DGGML_SYCL_F16=ON`), not something the launcher can set.

**Overrides**

- `ATOM_SKIP_UNLOAD_OTHERS=1` — do not eject other apps.
- `ATOM_SKIP_B70_FLAGS=1` — old behavior (`--n-gpu-layers 99` only).
- `ATOM_LLAMA_SPLIT=layer` — force every model onto both cards (overrides the SYCL1 default).
- `ATOM_LLAMA_SPLIT=none ATOM_LLAMA_DEVICE=SYCL1` — explicit single-card pin (this is already the default).
- `ATOM_LLAMA_SPLIT=tensor` — tensor parallel instead of layer (needs FA; **not** `row`; slower 27B Q4 here).
- `ATOM_SYCL_FA_ONEDNN=0` — if long-context output is garbage on an older SYCL binary.
- `ATOM_CTX` (default **0** = each model's own trained maximum, e.g. 262144 for Qwen3.8). Local models are never capped to 32768; `ATOM_CTX=32768` is refused and treated as 0. Only set a number for a deliberate one-off experiment.
- `ATOM_KV_QUANT` — at native context the KV cache defaults to `q4_0` (same as `~/.local/bin/llama-server-direct`; an f16 cache at 262k is what makes decode crawl). Between 32k and native it defaults to `q8_0`. Set `0` for f16, `1` for q8_0, or `q4_0` / `q8_0` / `f16` explicitly.
- `ATOM_BATCH`, `ATOM_UBATCH`, `ATOM_N_GPU_LAYERS`, `ATOM_LLAMA_PARALLEL`, `ATOM_TENSOR_SPLIT`.

GPU flags only take effect when this script **starts** llama-server. If port 8080 is already up, that process is reused; other apps are still unloaded.

## Qwen3.8-Flash-Next (85 GB, both GPUs, port 8081)

Flash-Next (`qwen4exp`, UD-Q3_K_XL) runs as its **own** OpenAI-compatible server on **:8081**, not in the :8080 router:

- The native llama.cpp build (`~/llama.cpp/build_sycl_new`) predates the `qwen4exp` architecture; only the newer Docker image (`ghcr.io/ggml-org/llama.cpp:server-intel`) can load it.
- It needs both B70s (layer split) plus host RAM (mmap), so it cannot share the router's single-card pin.

```bash
llama-flash-next start    # systemd service llama-flash-next.service, waits for /health (ctx 32768 = last-known-good; see below)
llama-flash-next status
llama-flash-next stop     # frees both cards
llama-load <alias>        # any router model; automatically stops Flash-Next first
```

Point any harness at `http://127.0.0.1:8081/v1`, model `Qwen3.8-Flash-Next-UD-Q3_K_XL`:

- **Atom Chat** — Settings → Connection → Backend URL = `http://localhost:8081` (empty/`:8080` for the router). Atom Chat detects that this is a single-model server, so it never tries `POST /models/load`.
- **Hermes** — provider `local-flash-next` (in the default config and the `coder`, `designer`, `ssh-zero3` profiles).

Symptoms:

- **“Won’t load” in Atom Chat while the container is up** — the Backend URL still points at :8080, which cannot see the container. Switch it to `:8081`.
- **Docker says `unhealthy`** — old manual containers used an image healthcheck against :8080. The service passes `--health-cmd` for the right port; recreate with `llama-flash-next restart`.
- **Router model fails to load while Flash-Next is up** — both cards are taken. `llama-flash-next stop`, or just run `llama-load <alias>`.
- **Vision is OFF by default, on purpose.** Desktop card (`0c:00.0` / SYCL0) shares VRAM with Cinnamon. With vision ON the launcher reserves headroom (`--fit on -fitt 3072,5120`, mmproj on SYCL1). Without that margin, image encode triggers an xe engine reset and the job hangs. Atom Chat also downscales Flash-Next images to ≤512px and waits up to 120s for the first vision token. After any `engine reset` / `Timedout job` in `journalctl -k`, **reboot before retrying vision**. `llama-flash-next start --vision` / `--no-vision` persists the choice.
- **Docker image is pinned** to build `4da63377` (`llamacpp-server-intel:2026-09-27-prev`) so a re-pull of the moving `ghcr.io/ggml-org/llama.cpp:server-intel` tag can't change speed/behaviour underneath you.
- **Context is 32768 here, not native (262144).** Trying 65536 / 131072 / 262144 made the GPU hang (`journalctl -k | grep -i 'engine reset'` shows `Timedout job in llama-server`; llama.cpp reports `UR_RESULT_ERROR_OUT_OF_RESOURCES`). Those results are not conclusive — the hangs also degraded the card afterwards (decode fell from ~20 to ~5 tok/s). After a clean reboot re-test one value at a time: `FLASH_NEXT_CTX=65536 llama-flash-next start`, and check the kernel log for resets after each attempt.
- **Decode suddenly ~5 tok/s or the load never finishes** — check `journalctl -k | grep -i 'engine reset'`. If the xe driver reset the card, reboot before doing anything else.
- Not enabled at boot on purpose (it takes ~85 GB and both GPUs; would collide with ComfyUI/H3).

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
| llama.cpp router | 8080 | Backend URL (default) |
| Flash-Next (Docker) | 8081 | Backend URL (`llama-flash-next`) |
| Voice server   | 8765 | Voice-to-text server |
| Unload helper  | 8766 | Unload helper        |
| Search proxy   | 5174 | (proxied by Vite)    |
| Dev UI         | 5173 or 5175 | —                |

Keeping these straight avoids “fix one thing, break another” when repairing voice or internet.
