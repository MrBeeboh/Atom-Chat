@echo off
setlocal enabledelayedexpansion
title ATOM UI
cd /d "%~dp0"

echo [ATOM] Running from: %CD%
echo [ATOM] If your app shows no changes, hard-refresh the browser: Ctrl+Shift+R
echo.

echo [ATOM] Clearing port 5173 if in use...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" 2>nul
echo [ATOM] Clearing port 8765 if in use (voice server)...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8765 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" 2>nul
echo [ATOM] Clearing port 5000 if in use (hardware metrics)...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 5000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" 2>nul
echo [ATOM] Clearing port 8766 if in use (unload helper)...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8766 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" 2>nul
ping 127.0.0.1 -n 2 >nul

echo [ATOM] Starting Unload helper (Port 8766)...
start "ATOM Unload Helper" cmd /k "cd /d "%~dp0" && pip install -r scripts/requirements-unload.txt -q && python scripts/unload_helper_server.py"
echo [ATOM] Starting Hardware metrics server (Port 5000)...
start "ATOM Hardware Metrics" cmd /k "cd /d "%~dp0" && pip install -r scripts/requirements-hardware.txt -q && python scripts/hardware_server.py"
echo [ATOM] Starting Voice server (Port 8765)...
start "ATOM Voice Server" cmd /k "cd /d "%~dp0voice-server" && if exist .venv\Scripts\activate.bat (call .venv\Scripts\activate.bat && uvicorn app:app --host 0.0.0.0 --port 8765) else (echo Voice server not set up. See voice-server\README.md: python -m venv .venv, pip install -r requirements.txt && pause)"

echo [ATOM] Starting Frontend (Port 5173)...
start "ATOM Frontend" cmd /k "npm run dev"

echo [ATOM] Waiting 10s for Vite dev server...
ping 127.0.0.1 -n 11 >nul

echo [ATOM] Launching browser...
start http://localhost:5173

echo.
echo [ATOM] LM Studio: run on port 1234 for your models.
echo [ATOM] Keep "ATOM Frontend", "ATOM Unload Helper", "ATOM Voice Server", and "ATOM Hardware Metrics" windows open.
echo [ATOM] First time metrics? pip install -r scripts/requirements-hardware.txt . First time voice? voice-server\README.md
pause
