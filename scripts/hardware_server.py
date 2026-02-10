"""
Hardware bridge for ATOM floating metrics panel.
Exposes GPU (pynvml) and CPU/RAM (psutil) at http://localhost:5000/metrics.

Run: pip install -r scripts/requirements-hardware.txt
     python scripts/hardware_server.py
"""
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
    }

    if gpu_handle:
        try:
            util = pynvml.nvmlDeviceGetUtilizationRates(gpu_handle)
            mem = pynvml.nvmlDeviceGetMemoryInfo(gpu_handle)
            metrics["gpu_util"] = util.gpu
            metrics["vram_used_gb"] = round(mem.used / (1024**3), 1)
            metrics["vram_total_gb"] = round(mem.total / (1024**3), 1)
        except Exception:
            pass

    return jsonify(metrics)


if __name__ == "__main__":
    print("Hardware bridge: http://localhost:5000/metrics")
    app.run(port=5000)
