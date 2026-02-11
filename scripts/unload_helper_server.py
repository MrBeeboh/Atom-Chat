"""
Unload helper: ejects all loaded models via LM Studio CLI (lms unload --all).
Exposes POST http://localhost:8766/unload-all. Started by start_atom_ui.bat.

  pip install flask flask-cors && python scripts/unload_helper_server.py
"""
import os
import subprocess
import shutil

from flask import Flask, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)


def find_lms_command():
    """lms CLI path (PATH or Windows default locations)."""
    lms_cmd = shutil.which("lms")
    if lms_cmd:
        return lms_cmd
    for path in [
        os.path.expandvars(r"%LOCALAPPDATA%\LM-Studio\lms.exe"),
        r"C:\Program Files\LM Studio\lms.exe",
    ]:
        if os.path.exists(path):
            return path
    return None


@app.route("/unload-all", methods=["POST", "GET"])
def unload_all():
    """Run lms unload --all; return { ok } or 500."""
    lms_cmd = find_lms_command()
    if not lms_cmd:
        return jsonify({
            "ok": False,
            "error": "lms CLI not found. Install LM Studio and ensure 'lms' command is in PATH or at %LOCALAPPDATA%\\LM-Studio\\lms.exe"
        }), 500
    
    try:
        result = subprocess.run(
            [lms_cmd, "unload", "--all"],
            capture_output=True,
            text=True,
            timeout=30
        )
        
        if result.returncode == 0:
            output = result.stdout.strip()
            return jsonify({
                "ok": True,
                "message": "All models unloaded via CLI",
                "output": output
            })
        else:
            return jsonify({
                "ok": False,
                "error": f"lms unload failed (exit {result.returncode}): {result.stderr.strip()}"
            }), 500
            
    except subprocess.TimeoutExpired:
        return jsonify({"ok": False, "error": "lms unload timed out after 30s"}), 500
    except Exception as e:
        return jsonify({"ok": False, "error": f"Failed to run lms CLI: {e}"}), 500


@app.route("/health")
def health():
    return jsonify({"ok": True, "service": "lmstudio-unload-helper", "lms": find_lms_command() or "not found"})


@app.route("/status")
def status():
    """Loaded model count via lms ps."""
    lms_cmd = find_lms_command()
    if not lms_cmd:
        return jsonify({"ok": False, "error": "lms CLI not found"}), 500
    
    try:
        result = subprocess.run([lms_cmd, "ps"], capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            lines = [l.strip() for l in result.stdout.strip().split('\n') if l.strip()]
            # Count non-header lines as loaded models
            loaded_count = max(0, len(lines) - 1) if lines else 0
            return jsonify({"ok": True, "loaded": loaded_count, "output": result.stdout.strip()})
        else:
            return jsonify({"ok": False, "error": result.stderr.strip()}), 500
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


if __name__ == "__main__":
    print("Unload helper: http://localhost:8766/unload-all (POST to eject all models)")
    app.run(port=8766)
