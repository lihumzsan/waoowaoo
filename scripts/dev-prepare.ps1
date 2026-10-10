param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 65535)]
    [int] $AppPort
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

$translations = @{
    en = @{
        ports = 'Taking over development ports: {0}'
        process = 'Stopping process tree: {0} (PID {1})'
        container = 'Stopping containers using development ports: {0}'
        ready = 'Development ports are free. Starting the project.'
        failed = 'Startup preparation failed: {0}'
        occupied = 'Port {0} is still occupied by PID {1}.'
        protected = 'Cannot terminate shared system or Docker process {0} (PID {1}); port ownership must be resolved first.'
    }
    zh = @{
        ports = '接管开发端口：{0}'
        process = '结束进程树：{0}（PID {1}）'
        container = '停止占用开发端口的容器：{0}'
        ready = '开发端口已释放，开始启动项目。'
        failed = '启动准备失败：{0}'
        occupied = '端口 {0} 仍被 PID {1} 占用。'
        protected = '不能结束共享系统或 Docker 进程 {0}（PID {1}）；必须先解决端口归属。'
    }
}
$language = if ([Globalization.CultureInfo]::CurrentUICulture.TwoLetterISOLanguageName -eq 'zh') { 'zh' } else { 'en' }
function Get-Text([string] $Key, [object[]] $Values = @()) {
    return $translations[$language][$Key] -f $Values
}

function Invoke-Docker([string[]] $DockerArguments) {
    $output = & docker @DockerArguments
    if ($LASTEXITCODE -ne 0) { throw "DOCKER_COMMAND_FAILED: docker $($DockerArguments[0]) ($LASTEXITCODE)" }
    return $output
}

function Get-Listeners {
    # Enumerate first: querying an unused port directly reports a CIM error.
    return @(Get-NetTCPConnection -State Listen | Where-Object { $ports -contains [int] $_.LocalPort })
}

function Stop-ProcessTree($Process) {
    $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($Process.ProcessId)"
    if (-not $current -or $current.CreationDate -ne $Process.CreationDate) { return }
    if ($protectedIds -contains [int] $current.ProcessId -or $current.ProcessId -le 4 -or
        $current.Name -match '^(System|svchost|services|lsass|wininit|csrss|com\.docker\..*|Docker Desktop|wsl.*|vmcompute|vmnat)\.exe$') {
        throw (Get-Text protected @($current.Name, $current.ProcessId))
    }
    Write-Host (Get-Text process @($current.Name, $current.ProcessId))
    & taskkill.exe /PID $current.ProcessId /T /F
    if ($LASTEXITCODE -ne 0) { throw "PROCESS_TERMINATION_FAILED:$($current.ProcessId)" }
}

try {
    # The npm script owns the infrastructure service selection; Compose owns
    # their dependencies and published ports. Do not maintain another list.
    $package = Get-Content -LiteralPath 'package.json' -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($package.scripts.'dev:infra' -notmatch '^docker compose up -d (?<services>[a-z0-9_-]+(?: [a-z0-9_-]+)*)$') {
        throw 'DEV_INFRA_COMMAND_UNSUPPORTED'
    }
    $services = $Matches.services.Split(' ')
    $configuration = (Invoke-Docker (@('compose', 'config', '--format', 'json') + $services)) -join "`n" | ConvertFrom-Json
    $ports = @($AppPort)
    foreach ($service in $configuration.services.PSObject.Properties) {
        foreach ($binding in $service.Value.ports) {
            if ($binding.protocol -ne 'tcp' -or [string] $binding.published -notmatch '^\d+$') {
                throw "DEV_PORT_BINDING_UNSUPPORTED:$($service.Name)"
            }
            $published = [int] $binding.published
            if ($published -eq $AppPort) { throw "DEV_APP_INFRA_PORT_CONFLICT:$AppPort" }
            $ports += $published
        }
    }
    $ports = @($ports | Sort-Object -Unique)
    Write-Host (Get-Text ports @($ports -join ', '))

    # Inspect exact container IDs before stopping anything. Docker Desktop's
    # listener PID is shared by all containers and must never be killed.
    $containerIds = @(Invoke-Docker @('ps', '--quiet', '--no-trunc'))
    $containersToStop = @()
    if ($containerIds.Count -gt 0) {
        $containers = (Invoke-Docker (@('inspect') + $containerIds)) -join "`n" | ConvertFrom-Json
        foreach ($container in $containers) {
            foreach ($mapping in $container.NetworkSettings.Ports.PSObject.Properties) {
                if ($mapping.Name -notmatch '/tcp$') { continue }
                if (@($mapping.Value | Where-Object { $ports -contains [int] $_.HostPort }).Count -gt 0) {
                    $containersToStop += $container.Id
                    break
                }
            }
        }
    }

    $processes = @(Get-CimInstance Win32_Process)
    $protectedIds = @()
    $ancestor = $processes | Where-Object ProcessId -EQ $PID
    while ($ancestor -and $protectedIds -notcontains [int] $ancestor.ProcessId) {
        $protectedIds += [int] $ancestor.ProcessId
        $parentId = $ancestor.ParentProcessId
        $parent = $processes | Where-Object ProcessId -EQ $parentId
        if ($parent -and $parent.CreationDate -gt $ancestor.CreationDate) { break }
        $ancestor = $parent
    }

    # Stop the existing app/worker group together, including its watcher.
    # Absolute module paths tie ownership to this checkout, not a process name.
    $moduleRoot = [IO.Path]::Combine($projectRoot, 'node_modules') + '\'
    $batchCommand = '\s/[ck]\s+["\s]*' + [regex]::Escape([IO.Path]::Combine($projectRoot, 'waoowaoo-dev.bat')) + '["\s]*$'
    $devProcesses = @($processes | Where-Object {
        ($_.Name -eq 'cmd.exe' -and $_.CommandLine -match $batchCommand) -or
        ($_.Name -eq 'node.exe' -and $_.CommandLine -and
        $_.CommandLine.Replace('/', '\').IndexOf($moduleRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        ($_.CommandLine -match 'concurrently[\\/]dist[\\/]bin[\\/]concurrently\.js.*npm run dev:next.*npm run dev:temporal-worker' -or
         $_.CommandLine -match 'tsx[\\/].*src[\\/]lib[\\/]temporal[\\/]worker\.ts' -or
         $_.CommandLine -match 'next[\\/]dist[\\/]bin[\\/]next.*\bdev\b'))
    } | Sort-Object CreationDate)
    foreach ($process in $devProcesses) {
        if ($protectedIds -notcontains [int] $process.ProcessId) { Stop-ProcessTree $process }
    }

    if ($containersToStop.Count -gt 0) {
        Write-Host (Get-Text container @($containersToStop -join ', '))
        # Stop only; keep containers and volumes. Allow databases to shut down
        # gracefully instead of forcing the shared Docker backend to exit.
        Invoke-Docker (@('stop', '--timeout', '30') + $containersToStop) | Out-Host
    }

    foreach ($listener in Get-Listeners | Sort-Object OwningProcess -Unique) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
        if ($process) { Stop-ProcessTree $process }
    }
    foreach ($listener in Get-Listeners) {
        throw (Get-Text occupied @($listener.LocalPort, $listener.OwningProcess))
    }
    Write-Host (Get-Text ready)
    exit 0
} catch {
    [Console]::Error.WriteLine((Get-Text failed @($_.Exception.Message)))
    exit 1
}
