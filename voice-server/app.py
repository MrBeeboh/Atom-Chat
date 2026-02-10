"""
Voice-to-text server for ATOM UI.
Uses the same stack as insanely-fast-whisper (Transformers + Whisper).
Run: uvicorn app:app --host 0.0.0.0 --port 8765
"""
import io
import os
import threading
import time
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

# Limits to avoid crashing the system
MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MB
MAX_DURATION_SECONDS = 120  # 2 minutes max audio
REQUEST_LOCK = threading.Lock()
PIPE_LOCK_TIMEOUT = 300  # 5 min max wait for lock

app = FastAPI(title="ATOM Voice", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Lazy-load pipeline to avoid loading at import time
_pipeline = None
_MODEL_NAME = os.environ.get("WHISPER_MODEL", "openai/whisper-base")


def _get_pipeline():
    global _pipeline
    if _pipeline is None:
        import torch
        from transformers import pipeline
        from transformers.utils import is_flash_attn_2_available

        device = "cuda:0" if torch.cuda.is_available() else ("mps" if hasattr(torch.backends, "mps") and torch.backends.mps.is_available() else "cpu")
        model_kwargs = (
            {"attn_implementation": "flash_attention_2"}
            if is_flash_attn_2_available()
            else {"attn_implementation": "sdpa"}
        )
        # Smaller batch_size to reduce memory; whisper-base is lighter than large-v3
        _pipeline = pipeline(
            "automatic-speech-recognition",
            model=_MODEL_NAME,
            torch_dtype=torch.float16 if device != "cpu" else torch.float32,
            device=device,
            model_kwargs=model_kwargs,
        )
    return _pipeline


@app.get("/health")
def health():
    return {"status": "ok", "model": _MODEL_NAME}


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(..., description="Audio file (webm, wav, etc.)")):
    # Accept any upload; we'll fail later if it's not valid audio
    raw = await audio.read()
    if len(raw) > MAX_FILE_BYTES:
        raise HTTPException(413, f"File too large (max {MAX_FILE_BYTES // (1024*1024)} MB)")

    # Save to temp file for librosa
    suffix = Path(audio.filename or "audio").suffix or ".webm"
    if suffix not in (".wav", ".mp3", ".flac", ".ogg", ".webm", ".m4a"):
        suffix = ".webm"
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(raw)
        tmp_path = tmp.name
    try:
        import librosa
        # Load and resample to 16 kHz (Whisper expects 16k). WebM may need ffmpeg installed.
        try:
            y, sr = librosa.load(tmp_path, sr=16000, mono=True)
        except Exception as load_err:
            raise HTTPException(
                400,
                f"Could not load audio (install ffmpeg for webm support): {getattr(load_err, 'message', str(load_err))}"
            )
        duration = len(y) / sr
        if duration > MAX_DURATION_SECONDS:
            raise HTTPException(413, f"Audio too long (max {MAX_DURATION_SECONDS}s)")
        acquired = REQUEST_LOCK.acquire(timeout=PIPE_LOCK_TIMEOUT)
        if not acquired:
            raise HTTPException(503, "Server busy; try again in a moment")
        try:
            pipe = _get_pipeline()
            out = pipe({"array": y, "sampling_rate": sr}, chunk_length_s=30, batch_size=8, return_timestamps=False)
            if isinstance(out, dict):
                text = (out.get("text") or "").strip()
            elif isinstance(out, list) and out and isinstance(out[0], dict):
                text = (out[0].get("text") or "").strip()
            else:
                text = str(out).strip()
            return {"text": text}
        finally:
            REQUEST_LOCK.release()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Transcription failed: {getattr(e, 'message', str(e))}")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
