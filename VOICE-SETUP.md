# Voice Bridge – run from this folder

The mic (Voice Bridge) only works if you run the app **from this project folder**.

## 1. Use this folder

- **Project path:** `c:\CURSOR\lm-studio-ui` (or wherever this repo lives).
- Open this folder in Cursor and run commands in a terminal **inside this folder**.

## 2. Install and run

```bash
cd c:\CURSOR\lm-studio-ui
npm install
npm run dev
```

- `npm install` runs `postinstall`, which copies ONNX runtime files into `public/ort/`.
- If you ever see "no available backend" or "ort-wasm-simd-threaded.mjs", run:
  ```bash
  npm run copy-ort
  ```

## 3. Open the app in the browser

- Go to **http://localhost:5173** (the URL printed by `npm run dev`).
- Do **not** open the app from a different path (e.g. another clone on OneDrive or another drive). Use the same folder where you ran `npm run dev`.

## 4. Use the mic

- Click the **mic** in the chat input bar or the **mic icon** in the header.
- The Voice Bridge modal opens. Wait for "Neural engine ready", then click the big mic and speak.

If you run `npm run dev` from a **different** folder (e.g. a copy of the project elsewhere), that other folder may not have `public/ort/` or the latest code, and the Voice Bridge will keep failing with the same error.
