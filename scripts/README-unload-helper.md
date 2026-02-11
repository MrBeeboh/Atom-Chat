# Unload helper (CLI-based)

LM Studio's REST unload API doesn't work for manually-loaded models (those loaded via GUI or persistently, not JIT). This helper uses the **`lms` CLI** to force-eject all loaded models.

## Why the CLI?

- **REST `/api/v1/models/unload`** and **Python SDK `model.unload()`** only work for JIT-loaded models
- **Manually-loaded models** (your 5-6 stuck models) require the CLI: **`lms unload --all`**
- The CLI has direct access to LM Studio's model manager and can eject any model

## Setup

1. **Install Flask** (no SDK needed):

   ```bash
   pip install -r scripts/requirements-unload.txt
   ```

2. **Verify `lms` CLI is available:**  
   Open a terminal and run:

   ```bash
   lms ps
   ```

   You should see your loaded models. If `lms` is not found:
   - **Windows:** The helper checks `%LOCALAPPDATA%\LM-Studio\lms.exe` automatically
   - **Mac/Linux:** Install LM Studio or add `lms` to PATH

3. **Start the helper:**

   ```bash
   python scripts/unload_helper_server.py
   ```

   Or double-click **`start_unload_helper.bat`** on Windows.

   Server runs at **http://localhost:8766**.

4. **In the app:**  
   **Settings** → **Unload helper** → set URL to `http://localhost:8766` → Save

## Usage

- Click **"Eject all"** in the Arena footer (left side, next to Questions button)
- Or start an Arena run (eject happens automatically)
- The helper runs **`lms unload --all`** to force-eject every loaded model

Check the Python terminal to see the CLI output.
