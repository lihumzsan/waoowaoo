@echo off
setlocal EnableExtensions

set "START_SCRIPT=%~dp0scripts\dev\start.ps1"
if not exist "%START_SCRIPT%" (
  echo [ERROR] Local startup script is missing: "%START_SCRIPT%"
  set "START_EXIT=1"
  goto :finish
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%START_SCRIPT%"
set "START_EXIT=%errorlevel%"
echo.
if "%START_EXIT%"=="0" (
  echo [OK] Open http://localhost:3000/zh
  echo The service runs in the background. Closing this window does not stop it.
) else (
  echo [ERROR] Startup failed. Review the error above.
  echo Logs: "%~dp0.runtime\local-startup"
)

:finish
echo.
pause
exit /b %START_EXIT%
