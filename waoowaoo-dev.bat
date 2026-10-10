@echo off
setlocal EnableExtensions

cd /d "%~dp0"
if errorlevel 1 (
  pause
  exit /b 1
)

if not defined PORT set "PORT=3000"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\dev-prepare.ps1" -AppPort "%PORT%"
if errorlevel 1 (
  pause
  exit /b 1
)

call npm run dev
set "START_EXIT=%errorlevel%"
if not "%START_EXIT%"=="0" pause
exit /b %START_EXIT%
