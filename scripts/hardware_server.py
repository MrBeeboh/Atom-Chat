"""
Hardware bridge for ATOM floating metrics panel.
Exposes GPU (pynvml + Intel sysfs) and CPU/RAM (psutil) at http://localhost:5000/metrics.

Run: pip install -r scripts/requirements-hardware.txt
     python scripts/hardware_server.py
"""
import glob
import os

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

gpu_handles = []
if HAS_NVML:
    try:
        pynvml.nvmlInit()
        count = pynvml.nvmlDeviceGetCount()
        for i in range(count):
            gpu_handles.append(pynvml.nvmlDeviceGetHandleByIndex(i))
    except Exception as e:
        print(f"NVML Init Failed: {e}")
        gpu_handles = []


def intel_vram_gb():
    """Sum Intel / other DRM VRAM from sysfs (Arc, iGPU). Returns (used, total, count)."""
    used = 0.0
    total = 0.0
    count = 0
    for card in glob.glob("/sys/class/drm/card*/device"):
        total_path = os.path.join(card, "mem_info_vram_total")
        used_path = os.path.join(card, "mem_info_vram_used")
        if not os.path.isfile(total_path):
            continue
        try:
            with open(total_path, "r", encoding="utf-8") as f:
                t = int(f.read().strip() or "0")
            u = 0
            if os.path.isfile(used_path):
                with open(used_path, "r", encoding="utf-8") as f:
                    u = int(f.read().strip() or "0")
            if t <= 0:
                continue
            total += t / (1024**3)
            used += u / (1024**3)
            count += 1
        except (OSError, ValueError):
            continue
    return used, total, count


@app.route("/metrics")
def get_metrics():
    cpu_usage = psutil.cpu_percent(interval=0.1)
    ram_info = psutil.virtual_memory()

    gpu_util = 0
    vram_used_gb = 0.0
    vram_total_gb = 0.0
    gpu_count = 0

    if gpu_handles:
        utils = []
        for handle in gpu_handles:
            try:
                util = pynvml.nvmlDeviceGetUtilizationRates(handle)
                mem = pynvml.nvmlDeviceGetMemoryInfo(handle)
                utils.append(util.gpu)
                vram_used_gb += mem.used / (1024**3)
                vram_total_gb += mem.total / (1024**3)
                gpu_count += 1
            except Exception:
                pass
        if utils:
            gpu_util = int(round(sum(utils) / len(utils)))

    if gpu_count == 0:
        i_used, i_total, i_count = intel_vram_gb()
        if i_count:
            vram_used_gb = i_used
            vram_total_gb = i_total
            gpu_count = i_count

    metrics = {
        "cpu_percent": cpu_usage,
        "ram_used_gb": round(ram_info.used / (1024**3), 1),
        "ram_total_gb": round(ram_info.total / (1024**3), 1),
        "gpu_util": gpu_util,
        "vram_used_gb": round(vram_used_gb, 1),
        "vram_total_gb": round(vram_total_gb, 1),
        "gpu_count": gpu_count,
    }

    return jsonify(metrics)


if __name__ == "__main__":
    print("Hardware bridge: http://localhost:5000/metrics")
    app.run(port=5000)
