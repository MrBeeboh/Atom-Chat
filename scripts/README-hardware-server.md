# Hardware bridge (metrics panel)

The floating **Metrics** panel shows **Tokens/s** (from the LLM stream), plus **VRAM**, **GPU util**, **Sys RAM**, and **CPU** when this bridge is running.

## Setup

```bash
pip install -r scripts/requirements-hardware.txt
python scripts/hardware_server.py
```

Server runs at **http://localhost:5000/metrics**. The app polls it every 1s when the Metrics panel is open.

## Dependencies

- **Flask + flask-cors** – HTTP server with CORS for the browser
- **pynvml** – NVIDIA GPU (VRAM, utilization); primary GPU (index 0) is used
- **psutil** – CPU % and system RAM

If pynvml is missing or no NVIDIA GPU, VRAM/GPU util will be 0; RAM and CPU still work.

## Custom URL

Set `localStorage.setItem('hardwareMetricsUrl', 'http://localhost:5001')` (then reload) if you run the server on another port or host.
