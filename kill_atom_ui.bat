@echo off
setlocal
title ATOM UI — Kill All
cd /d "%~dp0"

echo [ATOM] Stopping all ATOM services...

echo [ATOM] Stopping frontend on port 5173...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" 2>nul
echo [ATOM] Stopping voice server on port 8765...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8765 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" 2>nul
echo [ATOM] Stopping hardware metrics on port 5000...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 5000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" 2>nul
echo [ATOM] Stopping unload helper on port 8766...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8766 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" 2>nul

echo.
echo [ATOM] All services stopped. Ports 5173, 8765, 5000, 8766 cleared.
timeout /t 2 /nobreak >nul
