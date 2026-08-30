@echo off
title ATOM - Stop services
cd /d "%~dp0"

echo [ATOM] Stopping ATOM services...
for %%P in (5173 5174 5175 8765 8766 5000) do (
  powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort %%P -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" 2>nul
)
taskkill /FI "WINDOWTITLE eq ATOM UI*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq ATOM Voice*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq ATOM Search Proxy*" /F >nul 2>&1
echo [ATOM] Done.
pause
