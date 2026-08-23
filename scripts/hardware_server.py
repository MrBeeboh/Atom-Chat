"""
Hardware bridge for ATOM floating metrics panel.
Exposes GPU (NVIDIA via pynvml, Intel Arc via sysfs) and CPU/RAM (psutil)
at http://localhost:5000/metrics.

Run: pip install -r scripts/requirements-hardware.txt
     python scripts/hardware_server.py
"""
from __future__ import annotations

import glob
import os
import subprocess

import psutil

try:
    import pynvml
    HAS_NVML = True
except ImportError:
    HAS_NVML = False

from flask import Flask, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

gpu_handle = None
if HAS_NVML:
    try:
        pynvml.nvmlInit()
        gpu_handle = pynvml.nvmlDeviceGetHandleByIndex(0)
    except Exception as e:
        print(f"NVML Init Failed: {e}")
        gpu_handle = None


def _read_sysfs_int(path: str) -> int | None:
    try:
        with open(path, encoding="utf-8") as f:
            return int(f.read().strip())
    except (OSError, ValueError):
        return None


def _intel_vram_from_sysfs() -> tuple[float, float, int]:
    """Return (used_gb, total_gb, gpu_util) for Intel iGPU/dGPU via DRM sysfs."""
    total = used = None
    for total_path in sorted(glob.glob("/sys/class/drm/card*/device/mem_info_vram_total")):
        vendor_path = total_path.replace("mem_info_vram_total", "vendor")
        try:
            with open(vendor_path, encoding="utf-8") as vf:
                if "0x8086" not in vf.read().lower():
                    continue
        except OSError:
            continue
        t = _read_sysfs_int(total_path)
        u_path = total_path.replace("mem_info_vram_total", "mem_info_vram_used")
        u = _read_sysfs_int(u_path)
        if t and t > 0:
            total = t
            used = u or 0
            break

    gpu_util = 0
    if shutil_which("intel_gpu_top"):
        try:
            out = subprocess.check_output(
                ["intel_gpu_top", "-J", "-s", "500"],
                stderr=subprocess.DEVNULL,
                timeout=2,
            )
            import json

            data = json.loads(out.decode("utf-8", errors="replace"))
            engines = data.get("engines", {}) if isinstance(data, dict) else {}
            busy_vals = []
            for eng in engines.values():
                if isinstance(eng, dict) and "busy" in eng:
                    busy_vals.append(float(eng["busy"]))
            if busy_vals:
                gpu_util = int(max(busy_vals))
        except Exception:
            pass

    if total is None:
        return 0.0, 0.0, 0
    return round(used / (1024**3), 1), round(total / (1024**3), 1), gpu_util


def shutil_which(cmd: str) -> str | None:
    for p in os.environ.get("PATH", "").split(os.pathsep):
        full = os.path.join(p, cmd)
        if os.path.isfile(full) and os.access(full, os.X_OK):
            return full
    return None


@app.route("/metrics")
def get_metrics():
    # interval=0.1 so we get a real value (interval=None returns 0 on first call)
    cpu_usage = psutil.cpu_percent(interval=0.1)
    ram_info = psutil.virtual_memory()

    metrics = {
        "cpu_percent": cpu_usage,
        "ram_used_gb": round(ram_info.used / (1024**3), 1),
        "ram_total_gb": round(ram_info.total / (1024**3), 1),
        "gpu_util": 0,
        "vram_used_gb": 0,
        "vram_total_gb": 0,
        "gpu_vendor": None,
    }

    if gpu_handle:
        try:
            util = pynvml.nvmlDeviceGetUtilizationRates(gpu_handle)
            mem = pynvml.nvmlDeviceGetMemoryInfo(gpu_handle)
            metrics["gpu_util"] = util.gpu
            metrics["vram_used_gb"] = round(mem.used / (1024**3), 1)
            metrics["vram_total_gb"] = round(mem.total / (1024**3), 1)
            metrics["gpu_vendor"] = "nvidia"
        except Exception:
            pass

    if metrics["vram_total_gb"] == 0:
        used_gb, total_gb, intel_util = _intel_vram_from_sysfs()
        if total_gb > 0:
            metrics["vram_used_gb"] = used_gb
            metrics["vram_total_gb"] = total_gb
            metrics["gpu_util"] = max(metrics["gpu_util"], intel_util)
            metrics["gpu_vendor"] = "intel"

    return jsonify(metrics)


if __name__ == "__main__":
    print("Hardware bridge: http://localhost:5000/metrics")
    app.run(port=5000)
