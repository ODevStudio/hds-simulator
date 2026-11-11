@echo off
setlocal
cd /d "%~dp0"
"runtime\node.exe" "launch.mjs"
if errorlevel 1 pause
