# Windows Development Start Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a foreground Windows launcher that starts the repository's existing `npm run dev` workflow from Explorer or a terminal.

**Architecture:** A root-level `start-dev.cmd` owns only Windows launcher concerns: resolving its directory, validating prerequisites, invoking `npm.cmd run dev`, and preserving the exit code. A standalone PowerShell test runs the launcher in temporary sandboxes with a fake `npm.cmd`, so launcher behavior is verified without starting another development stack.

**Tech Stack:** Windows Command Prompt batch syntax, PowerShell 5.1+, npm scripts

## Global Constraints

- The launcher file is named `start-dev.cmd` and lives in the repository root.
- It runs in the foreground and keeps development logs visible.
- It invokes the existing `npm.cmd run dev`; it does not duplicate service startup logic.
- It does not install dependencies, edit `.env`, run in the background, detect occupied ports, or add a stop script.
- It must bypass PowerShell's `npm.ps1` execution-policy restriction by calling `npm.cmd` explicitly.

---

### Task 1: Foreground Windows Development Launcher

**Files:**
- Create: `tests/scripts/start-dev-script.test.ps1`
- Create: `start-dev.cmd`

**Interfaces:**
- Consumes: the existing `package.json` script `dev` and an `npm.cmd` executable available on `PATH`
- Produces: `start-dev.cmd`, a foreground launcher whose process exit code matches `npm.cmd run dev`

- [ ] **Step 1: Write the failing launcher behavior test**

Create `tests/scripts/start-dev-script.test.ps1` with this content:

```powershell
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$launcher = Join-Path $repoRoot 'start-dev.cmd'

if (-not (Test-Path -LiteralPath $launcher)) {
    throw 'Expected start-dev.cmd to exist in the repository root.'
}

$tempRoot = Join-Path $env:TEMP ('waoowaoo-start-dev-test-' + [guid]::NewGuid().ToString('N'))
$systemPath = Join-Path $env:SystemRoot 'System32'

function Assert-Equal {
    param($Actual, $Expected, [string]$Message)
    if ($Actual -ne $Expected) {
        throw "$Message Expected: $Expected; Actual: $Actual"
    }
}

function Assert-Match {
    param([string]$Actual, [string]$Pattern, [string]$Message)
    if ($Actual -notmatch $Pattern) {
        throw "$Message Pattern: $Pattern; Actual: $Actual"
    }
}

function Invoke-TestLauncher {
    param(
        [string]$Sandbox,
        [string]$PathValue,
        [string]$FakeNpmExit = '0'
    )

    $previousPath = $env:PATH
    $previousLog = $env:FAKE_NPM_LOG
    $previousExit = $env:FAKE_NPM_EXIT
    try {
        $env:PATH = $PathValue
        $env:FAKE_NPM_LOG = Join-Path $Sandbox 'npm-args.txt'
        $env:FAKE_NPM_EXIT = $FakeNpmExit
        Push-Location $Sandbox
        try {
            $output = (& cmd.exe /d /c 'start-dev.cmd <nul' 2>&1 | Out-String)
            $exitCode = $LASTEXITCODE
        } finally {
            Pop-Location
        }
        return @{ ExitCode = $exitCode; Output = $output; Log = $env:FAKE_NPM_LOG }
    } finally {
        $env:PATH = $previousPath
        $env:FAKE_NPM_LOG = $previousLog
        $env:FAKE_NPM_EXIT = $previousExit
    }
}

try {
    New-Item -ItemType Directory -Path $tempRoot | Out-Null

    $missingProject = Join-Path $tempRoot 'missing-project'
    New-Item -ItemType Directory -Path $missingProject | Out-Null
    Copy-Item -LiteralPath $launcher -Destination $missingProject
    $result = Invoke-TestLauncher -Sandbox $missingProject -PathValue $systemPath
    Assert-Equal $result.ExitCode 1 'Missing package.json must fail.'
    Assert-Match $result.Output 'package\.json' 'Missing-project error must explain the prerequisite.'

    $missingNpm = Join-Path $tempRoot 'missing-npm'
    New-Item -ItemType Directory -Path $missingNpm | Out-Null
    Copy-Item -LiteralPath $launcher -Destination $missingNpm
    Set-Content -LiteralPath (Join-Path $missingNpm 'package.json') -Value '{}'
    $result = Invoke-TestLauncher -Sandbox $missingNpm -PathValue $systemPath
    Assert-Equal $result.ExitCode 1 'Missing npm.cmd must fail.'
    Assert-Match $result.Output 'npm\.cmd' 'Missing-npm error must explain the prerequisite.'

    $fakeBin = Join-Path $tempRoot 'fake-bin'
    New-Item -ItemType Directory -Path $fakeBin | Out-Null
    Set-Content -LiteralPath (Join-Path $fakeBin 'npm.cmd') -Encoding Ascii -Value @'
@echo off
> "%FAKE_NPM_LOG%" echo %*
exit /b %FAKE_NPM_EXIT%
'@

    $success = Join-Path $tempRoot 'success'
    New-Item -ItemType Directory -Path $success | Out-Null
    Copy-Item -LiteralPath $launcher -Destination $success
    Set-Content -LiteralPath (Join-Path $success 'package.json') -Value '{}'
    $result = Invoke-TestLauncher -Sandbox $success -PathValue "$fakeBin;$systemPath"
    Assert-Equal $result.ExitCode 0 'Successful npm execution must return zero.'
    Assert-Equal (Get-Content -Raw $result.Log).Trim() 'run dev' 'Launcher must invoke npm.cmd run dev.'

    $failure = Join-Path $tempRoot 'failure'
    New-Item -ItemType Directory -Path $failure | Out-Null
    Copy-Item -LiteralPath $launcher -Destination $failure
    Set-Content -LiteralPath (Join-Path $failure 'package.json') -Value '{}'
    $result = Invoke-TestLauncher -Sandbox $failure -PathValue "$fakeBin;$systemPath" -FakeNpmExit '23'
    Assert-Equal $result.ExitCode 23 'Launcher must preserve the npm exit code.'
    Assert-Match $result.Output '23' 'Failure output must include the npm exit code.'

    Write-Host 'PASS: start-dev.cmd launcher behavior'
} finally {
    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force
    }
}
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\scripts\start-dev-script.test.ps1
```

Expected: exit code `1` with `Expected start-dev.cmd to exist in the repository root.`

- [ ] **Step 3: Implement the minimal launcher**

Create `start-dev.cmd` with this content:

```batch
@echo off
setlocal

cd /d "%~dp0" || (
    echo [ERROR] Could not open the project directory.
    pause
    exit /b 1
)

if not exist "package.json" (
    echo [ERROR] package.json was not found in "%CD%".
    pause
    exit /b 1
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm.cmd was not found on PATH. Install Node.js and try again.
    pause
    exit /b 1
)

echo Starting waoowaoo in development mode...
echo Press Ctrl+C to stop all development services.
echo.

call npm.cmd run dev
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo [ERROR] Development services exited with code %EXIT_CODE%.
    pause
)

exit /b %EXIT_CODE%
```

- [ ] **Step 4: Run the test and verify GREEN**

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\scripts\start-dev-script.test.ps1
```

Expected: exit code `0` and `PASS: start-dev.cmd launcher behavior`.

- [ ] **Step 5: Verify formatting and the existing live server**

Run:

```powershell
git diff --check
curl.exe -sS -I --max-time 30 http://127.0.0.1:3000/
```

Expected: `git diff --check` prints nothing and exits `0`; the HTTP check exits `0` and returns a `307` redirect to `/zh` or a successful `2xx` response.

- [ ] **Step 6: Commit the implementation**

```powershell
git add -- start-dev.cmd tests/scripts/start-dev-script.test.ps1
git commit -m "feat: add Windows development launcher"
```
