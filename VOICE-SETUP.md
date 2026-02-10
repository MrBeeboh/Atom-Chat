# Voice-to-text (insanely-fast-whisper backend)

The **mic button** in the chat input sends recorded audio to a **local Python server** that uses the same stack as insanely-fast-whisper (Transformers + Whisper). No browser-based speech recognition.

## 1. Run the voice server

From the project folder:

```bash
cd voice-server
python -m venv .venv
.venv\Scripts\activate    # Windows
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8765
```

See **voice-server/README.md** for details (smaller model, limits, options).

## 2. Use the mic in ATOM UI

- Start the frontend: `npm run dev` (or use `start_atom_ui.bat`).
- Open **Settings** → **Voice-to-text server** should be `http://localhost:8765` (default).
- In the chat input bar, click the **mic** (🎤). Click again to stop recording; the server will transcribe and insert text into the input.

## 3. If something goes wrong

- **Mic shows an error:** Make sure the voice server is running on port 8765 and the URL in Settings is correct.
- **Server OOM / crash:** Use a smaller model: `set WHISPER_MODEL=openai/whisper-base` (see voice-server/README.md).
- **Revert the whole voice feature:**  
  Git was marked before adding voice. To go back:
  ```bash
  git log --oneline
  git reset --hard <REVERT_POINT_COMMIT>
  ```
  The revert-point commit message is: **"REVERT POINT: before voice-to-text (insanely-fast-whisper). Revert to this if voice feature causes issues."**
