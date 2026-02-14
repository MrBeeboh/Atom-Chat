@echo off
setlocal
title LM Studio Unload Helper
REM Run from repo root so scripts/ paths resolve.
cd /d "%~dp0"
echo [ATOM] Unload helper starting: http://localhost:8766/unload-all
echo [ATOM] Set this URL in Settings ^> Unload helper (Python SDK) in the app.
echo.
pip install -r "%~dp0scripts\requirements-unload.txt" -q
python "%~dp0scripts\unload_helper_server.py"
pause
