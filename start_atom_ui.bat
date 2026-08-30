@echo off
setlocal enabledelayedexpansion
title ATOM Chat
cd /d "%~dp0"

if not defined ATOM_UI_PORT set ATOM_UI_PORT=5175

echo [ATOM] Running from: %CD%
echo [ATOM] UI port: %ATOM_UI_PORT%
echo.

echo [ATOM] Clearing stuck ports (5174, %ATOM_UI_PORT%, 8765)...
for %%P in (5174 %ATOM_UI_PORT% 8765) do (
  powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort %%P -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" 2>nul
)
ping 127.0.0.1 -n 2 >nul

if exist "scripts\search-proxy.mjs" (
  echo [ATOM] Starting search proxy (5174)...
  start "ATOM Search Proxy" /min cmd /c "cd /d "%~dp0" && node scripts\search-proxy.mjs"
)

if exist "voice-server\app.py" (
  echo [ATOM] Starting voice server (8765)...
  start "ATOM Voice" /min cmd /c "cd /d "%~dp0voice-server" && (if exist .venv\Scripts\activate.bat (call .venv\Scripts\activate.bat) else if exist venv\Scripts\activate.bat (call venv\Scripts\activate.bat)) && python -m uvicorn app:app --host 0.0.0.0 --port 8765"
)

echo [ATOM] Starting UI (port %ATOM_UI_PORT%)...
start "ATOM UI" /min cmd /k "cd /d "%~dp0" && npm run dev -- --port %ATOM_UI_PORT% --strictPort"

echo [ATOM] Waiting for Vite...
set /a tries=0
:wait_loop
set /a tries+=1
powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri 'http://localhost:%ATOM_UI_PORT%/' -UseBasicParsing -TimeoutSec 2).StatusCode | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if %ERRORLEVEL%==0 goto open_browser
if %tries% GEQ 40 goto wait_failed
ping 127.0.0.1 -n 2 >nul
goto wait_loop

:wait_failed
echo [ATOM] WARNING: UI is slow to start. Check the "ATOM UI" window for errors.
echo [ATOM] You can also open http://localhost:%ATOM_UI_PORT%/ manually.

:open_browser
echo.
echo [ATOM] Opening http://localhost:%ATOM_UI_PORT%/
start "" "http://localhost:%ATOM_UI_PORT%/"

echo.
echo [ATOM] ATOM is running in minimized taskbar windows (Search Proxy, Voice, UI).
echo [ATOM] This launcher can close now — services keep running.
echo [ATOM] To stop everything later, close those windows or run kill_atom_ui.bat
echo.
pause
exit /b 0
