@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0"
set "APP_PORT=3000"
set "APP_URL=http://127.0.0.1:%APP_PORT%/zh"

cd /d "%ROOT%"
if errorlevel 1 (
  echo [ERROR] Cannot enter project directory: %ROOT%
  exit /b 1
)

echo [1/3] Stopping processes listening on port %APP_PORT%...
set "STOPPED=0"
for /f "usebackq delims=" %%P in (`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -State Listen -LocalPort %APP_PORT% -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique"`) do (
  set "STOPPED=1"
  echo       Stopping PID %%P and its process tree...
  taskkill.exe /PID %%P /T /F >nul 2>&1
)

if "!STOPPED!"=="0" echo       Port %APP_PORT% was already free.

echo [2/3] Waiting for port %APP_PORT% to be released...
set /a WAITED=0
:wait_for_port
call :port_is_listening
if errorlevel 1 goto port_released
if !WAITED! GEQ 20 (
  echo [ERROR] Port %APP_PORT% is still in use after 20 seconds. Startup cancelled.
  exit /b 1
)
timeout.exe /t 1 /nobreak >nul
set /a WAITED+=1
goto wait_for_port

:port_released
echo       Port %APP_PORT% is free.
if "!STOPPED!"=="1" timeout.exe /t 2 /nobreak >nul

echo [3/3] Starting Waoowaoo from %ROOT%...
echo       URL: %APP_URL%
echo       Keep this window open. Press Ctrl+C to stop the development service.
echo.
call npm.cmd run dev:local
set "START_EXIT=!ERRORLEVEL!"
if not "!START_EXIT!"=="0" echo [ERROR] Waoowaoo exited with code !START_EXIT!.
exit /b !START_EXIT!

:port_is_listening
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "if (Get-NetTCPConnection -State Listen -LocalPort %APP_PORT% -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>&1
exit /b %ERRORLEVEL%
