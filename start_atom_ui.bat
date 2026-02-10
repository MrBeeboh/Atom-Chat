@echo off
setlocal enabledelayedexpansion
title ATOM UI
cd /d "%~dp0"

echo [ATOM] Running from: %CD%
echo [ATOM] If your app shows no changes, hard-refresh the browser: Ctrl+Shift+R
echo.

echo [ATOM] Clearing port 5173 if in use...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" 2>nul
ping 127.0.0.1 -n 2 >nul

echo [ATOM] Starting Frontend (Port 5173)...
start "ATOM Frontend" cmd /k "npm run dev"

echo [ATOM] Waiting 10s for Vite dev server...
ping 127.0.0.1 -n 11 >nul

echo [ATOM] Launching browser...
start http://localhost:5173

echo.
echo [ATOM] Make sure LM Studio is running on port 1234 for your models.
echo [ATOM] Keep the "ATOM Frontend" window open while using the app.
pause
