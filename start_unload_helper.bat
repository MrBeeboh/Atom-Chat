@echo off
cd /d "%~dp0"
title LM Studio Unload Helper
echo Unload helper: http://localhost:8766/unload-all
echo Set this URL in Settings ^> Unload helper (Python SDK) in the app.
echo.
pip install -r scripts/requirements-unload.txt -q
python scripts/unload_helper_server.py
pause
