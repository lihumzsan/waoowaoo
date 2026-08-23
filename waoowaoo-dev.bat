@echo off
setlocal EnableExtensions

cd /d C:\work\workspace\waoowaoo

netstat -ano | findstr /R /C:":3000[^0-9].*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo [ERROR] Port 3000 is already in use. Something may already be running.
  echo Run "netstat -ano | findstr :3000" to find the PID, then "taskkill /PID <pid> /F" to stop it.
  exit /b 1
)

call npm run storage:init
if errorlevel 1 (
  echo [ERROR] storage:init failed.
  exit /b 1
)

call npx concurrently --kill-others "npm run dev:next" "npm run dev:temporal-worker"