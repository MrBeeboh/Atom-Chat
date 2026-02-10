# Voice-to-text server (insanely-fast-whisper stack)

Backend for the ATOM UI mic button. Uses the same stack as [insanely-fast-whisper](https://github.com/Vaibhavs10/insanely-fast-whisper): Hugging Face Transformers + Whisper.

## Quick start

1. **Create and activate a venv** (recommended):

   ```bash
   cd voice-server
   python -m venv .venv
   .venv\Scripts\activate   # Windows
   # source .venv/bin/activate   # macOS/Linux
   ```

2. **Install dependencies** (first run can take a few minutes; downloads PyTorch and Whisper).  
   **Windows:** For browser-recorded WebM audio, install [ffmpeg](https://ffmpeg.org/download.html) and add it to your PATH (librosa uses it to load webm).

   ```bash
   pip install -r requirements.txt
   ```

3. **Run the server**:

   ```bash
   uvicorn app:app --host 0.0.0.0 --port 8765
   ```

4. In ATOM UI, open **Settings** and set **Voice-to-text server** to `http://localhost:8765` (default). Use the **mic button** in the chat input to record and transcribe.

## Options

- **Smaller model (less VRAM/RAM):** Before starting the server:
  ```bash
  set WHISPER_MODEL=openai/whisper-base
  uvicorn app:app --host 0.0.0.0 --port 8765
  ```
  Default is `openai/whisper-base`. For better accuracy and a powerful GPU, use `openai/whisper-large-v3` (needs more VRAM).

- **Port:** Change `8765` if something else uses it.

## Limits (to avoid overloading your system)

- Max upload: **10 MB** per request.
- Max audio length: **2 minutes** per request.
- **One transcription at a time** (queue); others wait or get 503.

## Revert voice feature

If the voice feature causes problems:

1. **Stop the voice server** (close the terminal running `uvicorn`).
2. **Disable in UI:** Settings → Voice-to-text server → clear the URL or set to empty and save. The mic will show an error if used.
3. **Fully remove the feature:** In the project root, revert to the commit before voice was added:
   ```bash
   git revert --no-commit HEAD
   # or reset to the marked revert point:
   git log --oneline
   git reset --hard <REVERT_POINT_COMMIT>
   ```
   The revert-point commit message is: **"REVERT POINT: before voice-to-text (insanely-fast-whisper). Revert to this if voice feature causes issues."**
