$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$stateRoot = Join-Path $projectRoot '.runtime/local-startup'
$nextPath = Join-Path $projectRoot 'node_modules/next/dist/bin/next'
$workerPath = Join-Path $projectRoot 'src/lib/temporal/worker.ts'
$tsxPath = Join-Path $projectRoot 'node_modules/tsx/dist/cli.mjs'
$checkPath = Join-Path $PSScriptRoot 'check-services.ts'
Set-Location -LiteralPath $projectRoot

# Prefer an installed Node.js; Codex desktop also supplies a per-user runtime.
$nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else {
    Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
}
foreach ($requiredPath in @($nodePath, $nextPath, $workerPath, $tsxPath, $checkPath, (Join-Path $projectRoot '.env'))) {
    if (!(Test-Path -LiteralPath $requiredPath -PathType Leaf)) { throw "Required local file is missing: $requiredPath" }
}
& $nodePath -e 'if (parseInt(process.versions.node, 10) < 22) process.exit(1)'
if ($LASTEXITCODE -ne 0) { throw 'Node.js 22 or newer is required.' }

$null = New-Item -ItemType Directory -Path $stateRoot -Force
# Serialise double clicks before reading PID files or creating background processes.
$launchLock = [IO.File]::Open((Join-Path $stateRoot 'start.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
try {
    $env:PATH = (Split-Path $nodePath) + ';' + $env:PATH
    $env:NEXT_TELEMETRY_DISABLED = '1'
    $env:NODE_ENV = 'development'
    $env:TEMPORAL_WORKER_BUILD_ID = 'local'
    $env:TEMPORAL_WORKER_VERSIONING_ENABLED = 'false'
    $env:TEMPORAL_WORKER_READY_FILE = Join-Path $stateRoot 'worker.ready'

    function Get-OwnedProcess([string] $Name, [string] $ScriptPath) {
        $pidPath = Join-Path $stateRoot ($Name + '.pid')
        if (!(Test-Path -LiteralPath $pidPath)) { return $null }
        $serviceId = 0
        if (![int]::TryParse((Get-Content -LiteralPath $pidPath -Raw).Trim(), [ref]$serviceId) -or $serviceId -le 0) {
            throw "Invalid $Name PID file: $pidPath"
        }
        $service = Get-CimInstance Win32_Process -Filter "ProcessId=$serviceId"
        if (!$service) { return $null }
        $scriptArgument = '(?:^|\s)"?' + [regex]::Escape($ScriptPath) + '"?(?=\s|$)'
        if (!$service.CommandLine -or $service.CommandLine -notmatch $scriptArgument) {
            throw "Recorded $Name PID belongs to a different process. No process was stopped."
        }
        return $service
    }

    $web = Get-OwnedProcess 'web' $nextPath
    $worker = Get-OwnedProcess 'worker' $workerPath
    if ($worker -and !$worker.CommandLine.Contains($tsxPath)) {
        throw 'The recorded Worker does not use automatic reload. Stop that local Worker before restarting.'
    }
    if ($web -and $web.CommandLine -notmatch '(?:^|\s)-p\s+3000(?:\s|$)') {
        throw 'The recorded web process does not use port 3000. Stop that local process before restarting.'
    }
    if (!$web -and (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) {
        throw 'Port 3000 is already occupied. Existing processes were left running.'
    }

    & $nodePath '--env-file=.env' '--import' 'tsx' $checkPath 'preflight'
    if ($LASTEXITCODE -ne 0) { throw 'Infrastructure preflight failed. No service was started.' }
    if (!$worker) {
        $workerArguments = @(('"' + $tsxPath + '"'), 'watch', '--env-file=.env', ('"' + $workerPath + '"'))
        $worker = Start-Process -FilePath $nodePath -ArgumentList $workerArguments -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $stateRoot 'worker.stdout.log') -RedirectStandardError (Join-Path $stateRoot 'worker.stderr.log') -PassThru
        $workerId = $worker.Id
        Set-Content -LiteralPath (Join-Path $stateRoot 'worker.pid') -Value $workerId
    } else {
        $workerId = $worker.ProcessId
    }
    Write-Output "Checking local Worker readiness (PID $workerId)..."
    & $nodePath '--env-file=.env' '--import' 'tsx' $checkPath 'worker' $workerId
    if ($LASTEXITCODE -ne 0) { throw "Worker readiness failed. Check $stateRoot/worker.stderr.log before retrying." }

    if (!$web) {
        $webArguments = @('--env-file=.env', '--no-deprecation', ('"' + $nextPath + '"'), 'dev', '--turbopack', '-H', '127.0.0.1', '-p', '3000')
        $web = Start-Process -FilePath $nodePath -ArgumentList $webArguments -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $stateRoot 'web.stdout.log') -RedirectStandardError (Join-Path $stateRoot 'web.stderr.log') -PassThru
        Set-Content -LiteralPath (Join-Path $stateRoot 'web.pid') -Value $web.Id
    }
    Write-Output 'Preparing local authentication and assistant endpoints...'
    & $nodePath '--env-file=.env' '--import' 'tsx' $checkPath 'web'
    if ($LASTEXITCODE -ne 0) { throw "Web readiness failed. Check $stateRoot/web.stderr.log before retrying." }
    Write-Output 'Local Web and Worker are ready: http://localhost:3000'
} finally {
    $launchLock.Dispose()
}
