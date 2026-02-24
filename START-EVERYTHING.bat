@echo off
setlocal
title AI Stack Launcher
REM Run from repo root: working dir = folder containing this .bat (project root).
cd /d "%~dp0"

REM Docker-free startup: LM Studio server + lm-studio-ui dev server.
REM All child processes start minimized — no window spam.

set "LM_PORT=1234"
set "LM_GUI_PATH_1=%LOCALAPPDATA%\Programs\LM Studio\LM Studio.exe"
set "LM_GUI_PATH_2=%ProgramFiles%\LM Studio\LM Studio.exe"

echo [INFO] Starting AI stack from: %CD%

REM 1) Start LM Studio headless server (port 1234) — minimized.
where lms >nul 2>nul
if errorlevel 1 goto no_lms

echo [INFO] Launching LM Studio server on port %LM_PORT% with CORS enabled [minimized]...
start /min "LM Studio Server" cmd /c "lms server start --port %LM_PORT% --cors"

REM 1b) Start local search proxy for web search (port 5174, ESM) — minimized.
echo [INFO] Starting local search proxy (port 5174) [minimized]...
start /min "Search Proxy" cmd /c "node scripts\search-proxy.mjs"
goto start_ui

:no_lms
echo [WARN] 'lms' CLI not found in PATH. Starting LM Studio UI instead.
call :start_gui

:start_ui
REM 2) Ensure deps then start the chat UI dev server (Vite) — minimized.
if not exist "node_modules" goto install_deps
goto run_ui

:install_deps
echo Installing dependencies...
call npm install

:run_ui
start /min "LM Studio UI" cmd /c "npm run dev"

REM 3) Start voice server for mic (port 8765) — minimized. Uses START-VOICE-SERVER.bat in project folder.
echo [INFO] Starting voice server (port 8765) [minimized]...
start /min "ATOM Voice Server" cmd /c "%~dp0START-VOICE-SERVER.bat"

REM 4) Open browser when Vite is up (Vite default is 5173)
timeout /t 5 /nobreak >nul
start "" "http://localhost:5173"

echo.
echo [INFO] All services started minimized in the taskbar.
echo [INFO] LM Studio server (%LM_PORT%), UI (5173), voice server (8765), browser.
echo [INFO] To stop: close the minimized windows or run kill_atom_ui.bat (from this folder).
timeout /t 3 /nobreak >nul
exit /b 0

:start_gui
if exist "%LM_GUI_PATH_1%" goto start_gui_1
if exist "%LM_GUI_PATH_2%" goto start_gui_2
echo [WARN] LM Studio GUI not found. Launch it manually.
exit /b 1

:start_gui_1
start "" "%LM_GUI_PATH_1%"
exit /b 0

:start_gui_2
start "" "%LM_GUI_PATH_2%"
exit /b 0
