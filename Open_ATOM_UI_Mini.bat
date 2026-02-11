@echo off
title ATOM UI - Open in browser
:: ============================================================
:: THIS IS THE ONLY FILE YOU NEED ON THE MINI.
:: No other files. No project folder. Just this file.
::
:: 1. Copy this .bat file to your mini PC (e.g. Desktop).
:: 2. Right-click it -> Edit. Change the IP below to your MAIN
::    PC's IP (on main PC run: ipconfig -> use IPv4 Address).
:: 3. On your main PC, start ATOM UI as usual (leave it running).
:: 4. On the mini: double-click this file. Browser opens and
::    loads the UI from your main PC. Done.
:: ============================================================
set MAIN_PC_IP=192.168.1.100

echo Opening ATOM UI at http://%MAIN_PC_IP%:5173
start "" "http://%MAIN_PC_IP%:5173"
