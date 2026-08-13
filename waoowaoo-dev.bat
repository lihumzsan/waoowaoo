@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0"
set "STATE_DIR=%ROOT%.runtime\dev-control"
set "PID_FILE=%STATE_DIR%\dev.pid"
set "LOG_FILE=%STATE_DIR%\dev.log"
set "APP_URL=http://127.0.0.1:3000/zh/home"

if not exist "%STATE_DIR%" mkdir "%STATE_DIR%" >nul 2>&1

set "ACTION=%~1"
if not defined ACTION set "ACTION=start"

if /I "%ACTION%"=="start" goto start_action
if /I "%ACTION%"=="stop" goto stop_action
if /I "%ACTION%"=="restart" goto restart_action
if /I "%ACTION%"=="status" goto status_action
if /I "%ACTION%"=="help" goto usage
if /I "%ACTION%"=="--help" goto usage
if /I "%ACTION%"=="-h" goto usage

echo [ERROR] Unknown action: %ACTION%
goto :usage_error

:start_action
echo [1/6] Checking whether Waoowaoo is already running...
call :is_running
if not errorlevel 1 (
  echo [OK] Waoowaoo is already running at %APP_URL%
  exit /b 0
)

call :project_port_owner
if not errorlevel 1 (
  echo [ERROR] Port 3000 is occupied by a Waoowaoo process that is not managed by this BAT.
  echo Run: %~nx0 stop
  exit /b 1
)

echo [2/6] Starting Docker infrastructure...
pushd "%ROOT%"
call npm.cmd run dev:infra
if errorlevel 1 (
  popd
  echo [ERROR] Docker infrastructure failed to start.
  exit /b 1
)

echo [3/6] Regenerating Prisma Client with the local query engine...
call npx.cmd prisma generate
if errorlevel 1 (
  popd
  echo [ERROR] Prisma Client generation failed.
  exit /b 1
)

echo [4/6] Checking the live database schema...
call npx.cmd prisma migrate diff --exit-code --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma
if errorlevel 1 (
  popd
  echo [ERROR] The live database schema does not match prisma/schema.prisma.
  echo No database change was applied automatically. Review the schema difference first.
  exit /b 1
)

echo [5/6] Starting Next.js and the Temporal worker in the background...
for /f "usebackq delims=" %%P in (`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$root=[IO.Path]::GetFullPath('%ROOT%'); $log=[IO.Path]::GetFullPath('%LOG_FILE%'); $command='cmd.exe /d /s /c npm.cmd run dev ^>^> "'+$log+'" 2^>^&1'; $startup=([wmiclass]'Win32_ProcessStartup').CreateInstance(); $startup.ShowWindow=0; $result=([wmiclass]'Win32_Process').Create($command,$root,$startup); if($result.ReturnValue -ne 0){exit $result.ReturnValue}; $result.ProcessId"`) do set "DEV_PID=%%P"
if not defined DEV_PID (
  popd
  echo [ERROR] Failed to create the background development process.
  exit /b 1
)
>"%PID_FILE%" echo !DEV_PID!

echo [6/6] Waiting for %APP_URL% ...
set /a WAITED=0
:wait_ready
curl.exe -fsS --max-time 3 "%APP_URL%" >nul 2>&1
if not errorlevel 1 goto :ready

if !WAITED! GEQ 180 (
  echo [ERROR] Timed out after 180 seconds waiting for the app.
  echo Log: %LOG_FILE%
  powershell.exe -NoProfile -Command "if(Test-Path -LiteralPath '%LOG_FILE%'){Get-Content -LiteralPath '%LOG_FILE%' -Tail 40}"
  popd
  exit /b 1
)

powershell.exe -NoProfile -Command "Start-Sleep -Seconds 2" >nul
set /a WAITED+=2
goto :wait_ready

:ready
popd
echo [OK] Waoowaoo is ready.
echo URL: %APP_URL%
echo PID: !DEV_PID!
echo Log: %LOG_FILE%
exit /b 0

:stop_action
echo Stopping Waoowaoo host processes...
set "STOPPED=0"
if exist "%PID_FILE%" (
  set /p DEV_PID=<"%PID_FILE%"
  powershell.exe -NoProfile -Command "if(Get-Process -Id !DEV_PID! -ErrorAction SilentlyContinue){exit 0}else{exit 1}" >nul 2>&1
  if not errorlevel 1 (
    taskkill.exe /PID !DEV_PID! /T /F >nul 2>&1
    if not errorlevel 1 set "STOPPED=1"
  )
  del /q "%PID_FILE%" >nul 2>&1
)

for /f "usebackq delims=" %%P in (`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$root=[IO.Path]::GetFullPath('%ROOT%').TrimEnd('\'); $all=@(Get-CimInstance Win32_Process); $c=Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -First 1; if($c){$chain=@(); $pid0=$c.OwningProcess; while($pid0){$p=$all | Where-Object ProcessId -eq $pid0 | Select-Object -First 1; if(-not $p){break}; $chain += $p; $pid0=$p.ParentProcessId}; $owned=$chain | Where-Object {$_.CommandLine -and $_.CommandLine.IndexOf($root,[StringComparison]::OrdinalIgnoreCase) -ge 0}; if($owned){$npmRoot=$chain | Where-Object {$_.Name -eq 'node.exe' -and $_.CommandLine -match 'npm-cli\.js.? run dev$'} | Select-Object -Last 1; if($npmRoot){$npmRoot.ProcessId}else{$c.OwningProcess}}}"`) do (
  taskkill.exe /PID %%P /T /F >nul 2>&1
  if not errorlevel 1 set "STOPPED=1"
)

call :wait_stopped
if errorlevel 1 (
  echo [ERROR] Port 3000 is still owned by a Waoowaoo process.
  exit /b 1
)

if "%STOPPED%"=="1" (
  echo [OK] Waoowaoo host processes stopped. Docker infrastructure was left running.
) else (
  echo [OK] Waoowaoo was not running. Docker infrastructure was left running.
)
exit /b 0

:restart_action
call "%~f0" stop
if errorlevel 1 exit /b 1
call "%~f0" start
exit /b %errorlevel%

:status_action
call :is_running
if not errorlevel 1 goto :status_managed

call :project_port_owner
if not errorlevel 1 goto :status_unmanaged

echo APP: STOPPED
goto :status_infrastructure

:status_managed
set /p DEV_PID=<"%PID_FILE%"
echo APP: RUNNING
echo URL: %APP_URL%
echo PID: !DEV_PID!
goto :status_infrastructure

:status_unmanaged
echo APP: RUNNING ^(unmanaged Waoowaoo process^)
echo URL: %APP_URL%

:status_infrastructure
echo.
echo Docker infrastructure:
pushd "%ROOT%"
docker compose ps mysql redis minio temporal
set "STATUS_EXIT=%errorlevel%"
popd
exit /b %STATUS_EXIT%

:is_running
if not exist "%PID_FILE%" exit /b 1
set /p CHECK_PID=<"%PID_FILE%"
powershell.exe -NoProfile -Command "if(Get-Process -Id !CHECK_PID! -ErrorAction SilentlyContinue){exit 0}else{exit 1}" >nul 2>&1
if errorlevel 1 (
  del /q "%PID_FILE%" >nul 2>&1
  exit /b 1
)
curl.exe -fsS --max-time 3 "%APP_URL%" >nul 2>&1
exit /b %errorlevel%

:project_port_owner
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$root=[IO.Path]::GetFullPath('%ROOT%').TrimEnd('\'); $all=@(Get-CimInstance Win32_Process); $c=Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -First 1; if(-not $c){exit 1}; $pid0=$c.OwningProcess; while($pid0){$p=$all | Where-Object ProcessId -eq $pid0 | Select-Object -First 1; if(-not $p){break}; if($p.CommandLine -and $p.CommandLine.IndexOf($root,[StringComparison]::OrdinalIgnoreCase) -ge 0){exit 0}; $pid0=$p.ParentProcessId}; exit 1" >nul 2>&1
exit /b %errorlevel%

:wait_stopped
set /a STOP_WAIT=0
:wait_stopped_loop
call :project_port_owner
if errorlevel 1 exit /b 0
if !STOP_WAIT! GEQ 20 exit /b 1
powershell.exe -NoProfile -Command "Start-Sleep -Seconds 1" >nul
set /a STOP_WAIT+=1
goto :wait_stopped_loop

:usage
echo Usage: %~nx0 [start^|stop^|restart^|status^|help]
echo.
echo Double-clicking this file is the same as: %~nx0 start
exit /b 0

:usage_error
echo Usage: %~nx0 [start^|stop^|restart^|status^|help]
exit /b 2
