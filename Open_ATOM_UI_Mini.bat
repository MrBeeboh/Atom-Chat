@echo off
cd /d "%~dp0"
title ATOM UI - Open in browser
:: ============================================================
:: USE THIS ON ANY DEVICE ON YOUR NETWORK.
:: Phone, tablet, mini PC, laptop — anything with a browser.
::
:: On your MAIN PC: start ATOM UI as usual (leave it running).
:: On the other device: open a browser and go to the URL below.
::
:: If you move this file to another device, just double-click it.
:: On a phone: just type the URL into Chrome. That's it.
:: ============================================================
set MAIN_PC_IP=10.0.0.51

echo.
echo =============================================
echo   ATOM UI — Access from any device
echo =============================================
echo.
echo   Open this URL on your phone or tablet:
echo.
echo   http://%MAIN_PC_IP%:5173
echo.
echo   (Your PC must be running ATOM UI)
echo =============================================
echo.

start "" "http://%MAIN_PC_IP%:5173"
timeout /t 5 /nobreak >nul
