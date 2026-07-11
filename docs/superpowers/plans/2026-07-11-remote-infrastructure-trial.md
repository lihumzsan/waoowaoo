# Remote Infrastructure Trial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the active `waoowaoo` source and all hot-reload Node processes on `192.168.0.116` while using the existing MySQL, Redis, MinIO, and ComfyUI Docker services on `192.168.0.112`.

**Architecture:** The local checkout remains the only application workspace. The trial first inventories and validates the existing remote Docker stack, then opens only the required ports to `192.168.0.116`, switches the ignored local `.env`, and exercises the full task path. The original local `.env` and Docker volumes remain intact for immediate rollback.

**Tech Stack:** Windows 11, PowerShell 5.1+, Docker Desktop, Next.js 15, Node.js, MySQL 8, Redis 7, MinIO, ComfyUI, Prisma, BullMQ

## Global Constraints

- Do not delete, prune, recreate, overwrite, or migrate any Docker volume on either machine.
- Do not print passwords, API keys, access keys, connection strings, or the full `.env` contents.
- Do not resume stale Redis jobs from the remote Redis volume.
- Keep the active Git checkout, Codex, Chrome, Next.js, workers, watchdog, and Bull Board on `192.168.0.116`.
- Reuse the existing Docker data on `192.168.0.112` only after non-destructive validation.
- Restrict MySQL, Redis, MinIO, and ComfyUI firewall rules on `192.168.0.112` to source `192.168.0.116`.
- Preserve the current local `.env` and local Docker services until all acceptance checks pass.
- On any failed acceptance check, stop the local application processes, restore the original `.env`, start local Docker services, and verify the original local path.

---

### Task 1: Record Local Baseline and Rollback Material

**Files:**
- Read: `.env`
- Create outside Git: a timestamped `C:\work\workspace\waoowaoo-local-backups\trial-yyyyMMdd-HHmmss\.env.local-backup`
- Read: `docker-compose.yml`

**Interfaces:**
- Consumes: the currently working local development environment.
- Produces: a secure `.env` backup path, local Docker container inventory, and local application health evidence.

- [ ] **Step 1: Stop only the application process tree after recording its current state**

Run from `C:\work\workspace\waoowaoo`:

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like '*C:\work\workspace\waoowaoo*' } |
  Select-Object ProcessId, ParentProcessId, Name, CommandLine
```

Expected: Next.js, worker, watchdog, and Bull Board processes are listed. Record their process IDs before stopping the foreground `npm run dev` window with `Ctrl+C`.

- [ ] **Step 2: Create a timestamped secure backup directory and copy `.env`**

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = "C:\work\workspace\waoowaoo-local-backups\trial-$stamp"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
Copy-Item -LiteralPath '.env' -Destination (Join-Path $backupDir '.env.local-backup')
Get-FileHash -Algorithm SHA256 (Join-Path $backupDir '.env.local-backup')
```

Expected: one SHA-256 line and no secret content printed.

- [ ] **Step 3: Record local Docker service state without printing environment variables**

```powershell
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"
docker volume ls
```

Expected: the current MySQL, Redis, and MinIO containers and volumes remain present.

- [ ] **Step 4: Verify the current local endpoint before changing configuration**

```powershell
curl.exe -sS -I --max-time 30 http://127.0.0.1:3000/
```

Expected: a `2xx` response or redirect before the application process tree is stopped.

---

### Task 2: Inventory Existing Docker Services on `192.168.0.112`

**Files:**
- Read remotely: the existing Docker Compose file and container metadata on `192.168.0.112`.
- Modify: none.

**Interfaces:**
- Consumes: RDP access to `192.168.0.112`.
- Produces: verified live container names, host ports, volumes, health, and restart policies.

- [ ] **Step 1: Open an elevated PowerShell session through RDP**

Expected: the prompt runs as an administrator on `192.168.0.112` without exposing credentials in the transcript.

- [ ] **Step 2: Inventory containers and ports**

Run remotely:

```powershell
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"
docker compose ls
docker volume ls
```

Expected: running MySQL, Redis, MinIO, and ComfyUI containers or an immediately identifiable stopped container for each service. Do not start an unknown container until its mounts and ports are inspected.

- [ ] **Step 3: Inspect health, volumes, ports, and restart policy without printing container environment variables**

```powershell
$servicePattern = 'mysql|redis|minio|comfy'
$containers = docker ps -a --format '{{.Names}} {{.Image}}' |
  Select-String -Pattern $servicePattern |
  ForEach-Object { ($_ -split ' ')[0] }

foreach ($name in $containers) {
  docker inspect $name --format '{{json .State}}'
  docker inspect $name --format '{{json .Mounts}}'
  docker inspect $name --format '{{json .NetworkSettings.Ports}}'
  docker inspect $name --format '{{.HostConfig.RestartPolicy.Name}}'
}
```

Expected: each service uses a persistent mount, has a known published port, and is running or can be started with its existing configuration.

- [ ] **Step 4: Start only known stopped services and recheck health**

```powershell
foreach ($name in $containers) {
  $running = docker inspect $name --format '{{.State.Running}}'
  if ($running -ne 'true') { docker start $name }
}
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"
```

Expected: MySQL, Redis, MinIO, and ComfyUI are running. If a container repeatedly exits, stop the trial and leave local configuration unchanged.

---

### Task 3: Validate Remote Data Non-Destructively

**Files:**
- Read remotely: Docker container state and application data.
- Modify: none, except clearing stale disposable Redis queue state only after its keys are inventoried.

**Interfaces:**
- Consumes: live remote MySQL, Redis, MinIO, and ComfyUI containers.
- Produces: evidence that remote data is complete enough for the trial and that stale jobs will not resume.

- [ ] **Step 1: Confirm MySQL is ready**

Run remotely, substituting the discovered MySQL container name through the dynamic lookup:

```powershell
$mysqlContainer = docker ps --format '{{.Names}} {{.Image}}' |
  Select-String -Pattern 'mysql' |
  Select-Object -First 1 |
  ForEach-Object { ($_ -split ' ')[0] }
docker exec $mysqlContainer mysqladmin ping -h 127.0.0.1 --silent
```

Expected: `mysqld is alive`. If authentication is required for `mysqladmin ping`, use the container's existing healthcheck result instead of printing a password.

- [ ] **Step 2: Confirm the application database and newest records through the existing remote project tooling**

From the existing remote project directory, run:

```powershell
npm.cmd run storage:init
npx.cmd prisma db pull --print | Select-Object -First 5
```

Expected: storage initialization verifies the existing bucket. Prisma prints the first five lines of the remote schema and exits `0`; authentication or network errors stop the trial.

- [ ] **Step 3: Inventory Redis without resuming work**

```powershell
$redisContainer = docker ps --format '{{.Names}} {{.Image}}' |
  Select-String -Pattern 'redis' |
  Select-Object -First 1 |
  ForEach-Object { ($_ -split ' ')[0] }
docker exec $redisContainer redis-cli PING
docker exec $redisContainer redis-cli --scan --pattern 'bull:*' | Select-Object -First 50
```

Expected: `PONG` and an inventory of at most the first 50 BullMQ keys. Do not start local workers while unexplained active or waiting jobs exist.

- [ ] **Step 4: Confirm MinIO and ComfyUI health**

Run remotely with the published ports discovered in Task 2:

```powershell
curl.exe -fsS --max-time 10 http://127.0.0.1:19000/minio/health/live
curl.exe -fsS --max-time 10 http://127.0.0.1:19000/minio/health/ready
curl.exe -fsS --max-time 10 http://127.0.0.1:8878/system_stats > $null
curl.exe -fsS --max-time 10 http://127.0.0.1:8878/queue > $null
```

Expected: all commands exit `0`. If live ports differ, use the exact published host ports from Task 2 and record them for Task 5.

---

### Task 4: Restrict Remote Service Access to the Development Workstation

**Files:**
- Modify remotely: Windows Firewall rules on `192.168.0.112`.
- Modify remotely only if necessary: the existing Docker Compose port publishing configuration.

**Interfaces:**
- Consumes: discovered host ports from Task 2.
- Produces: MySQL, Redis, MinIO, and ComfyUI endpoints reachable from `192.168.0.116` and not intentionally exposed to other LAN clients.

- [ ] **Step 1: Add source-restricted firewall rules for the confirmed ports**

Run remotely in elevated PowerShell after replacing the array only with ports confirmed in Task 2:

```powershell
$source = '192.168.0.116'
$ports = 13306,16379,19000,19001,8878
foreach ($port in $ports) {
  $name = "waoowaoo-dev-$port-from-116"
  Remove-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow `
    -Protocol TCP -LocalPort $port -RemoteAddress $source -Profile Private
}
```

Expected: one enabled inbound rule per confirmed port, scoped to `192.168.0.116` and the Private profile.

- [ ] **Step 2: Confirm port publishing is not loopback-only**

```powershell
docker ps --format "table {{.Names}}\t{{.Ports}}"
Get-NetTCPConnection -State Listen |
  Where-Object { $_.LocalPort -in 13306,16379,19000,19001,8878 } |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

Expected: required ports listen on `0.0.0.0`, `::`, or `192.168.0.112`, not only `127.0.0.1`. If a required port is unpublished or loopback-only, modify the existing Compose file to publish that confirmed service port, then run `docker compose up -d` for only that service.

- [ ] **Step 3: Verify connectivity from `192.168.0.116`**

```powershell
$hostAddress = '192.168.0.112'
13306,16379,19000,19001,8878 | ForEach-Object {
  Test-NetConnection -ComputerName $hostAddress -Port $_ -InformationLevel Detailed |
    Select-Object ComputerName, RemotePort, TcpTestSucceeded
}
```

Expected: `TcpTestSucceeded` is `True` for every confirmed service port.

---

### Task 5: Switch the Local Ignored `.env` to Remote Infrastructure

**Files:**
- Modify, ignored: `.env`
- Read: `.env.example`
- Preserve outside Git: the backup produced by Task 1.

**Interfaces:**
- Consumes: confirmed remote ports and existing credentials.
- Produces: local Next.js and workers configured for remote MySQL, Redis, MinIO, and ComfyUI.

- [ ] **Step 1: Update only host and port fields while preserving credentials**

Apply these endpoint changes in `.env` without printing the resulting lines. The ports are the established project ports and must already have passed Task 4 connectivity checks:

```text
DATABASE_URL: preserve scheme, username, password, and database; set host to 192.168.0.112 and port to 13306
REDIS_HOST=192.168.0.112
REDIS_PORT=16379
MINIO_ENDPOINT=http://192.168.0.112:19000
```

Keep `MINIO_BUCKET`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_REGION`, and `MINIO_FORCE_PATH_STYLE` unchanged unless the remote inspection proves the existing remote values differ. Keep the configured ComfyUI provider at `http://192.168.0.112:8878`.

- [ ] **Step 2: Verify storage and database connectivity before starting workers**

```powershell
npm.cmd run storage:init
npx.cmd prisma db pull --print | Select-Object -First 5
```

Expected: MinIO bucket verification succeeds. Prisma prints the first five lines of the remote schema and exits `0`; connection or authentication errors trigger rollback.

- [ ] **Step 3: Start the local development process tree**

```powershell
npm.cmd run dev
```

Expected: Next.js, worker, watchdog, and Bull Board remain running without Redis, database, or storage connection errors.

---

### Task 6: Execute Acceptance Checks and Measure the Result

**Files:**
- Modify: none.
- Read: application logs and process metrics.

**Interfaces:**
- Consumes: the switched local development environment.
- Produces: pass/fail evidence and either an accepted remote-infrastructure trial or a completed rollback.

- [ ] **Step 1: Verify application and existing data**

Open `http://127.0.0.1:3000/` and verify:

```text
login succeeds
expected projects and episodes are present
representative image, video, and audio assets open
provider configuration is readable
```

Expected: all four checks pass against the existing remote Docker data.

- [ ] **Step 2: Verify asynchronous task paths**

Run one small text task, one small ComfyUI task, and one Codex CLI provider smoke test.

Expected: tasks enter remote Redis, local workers process them, database state updates on remote MySQL, and media is readable from remote MinIO.

- [ ] **Step 3: Verify hot reload behavior**

Make one reversible whitespace-only frontend edit and one reversible whitespace-only worker edit, then restore both files.

Expected: Next.js Fast Refresh occurs for the frontend file; `tsx watch` restarts the worker and reconnects to remote Redis for the worker file.

- [ ] **Step 4: Stop local infrastructure containers only after acceptance passes**

```powershell
docker compose stop mysql redis minio
```

Expected: the application remains healthy because all active connections use `192.168.0.112`. Do not remove containers or volumes.

- [ ] **Step 5: Measure workstation memory after the switch**

```powershell
$names = 'chrome','node','vmmemWSL','Code','codex','com.docker.backend'
Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $names -contains $_.ProcessName } |
  Group-Object ProcessName |
  ForEach-Object {
    [pscustomobject]@{
      Name = $_.Name
      Count = $_.Count
      WorkingSetMB = [math]::Round(($_.Group | Measure-Object WorkingSet64 -Sum).Sum / 1MB, 1)
      PrivateMB = [math]::Round(($_.Group | Measure-Object PrivateMemorySize64 -Sum).Sum / 1MB, 1)
    }
  } | Sort-Object WorkingSetMB -Descending
```

Expected: WSL/Docker infrastructure memory is lower than the recorded baseline while application behavior remains correct.

---

### Task 7: Automatic Rollback on Any Failed Acceptance Check

**Files:**
- Restore: `.env` from the Task 1 backup.
- Modify: none of the Docker volumes.

**Interfaces:**
- Consumes: any failed check from Tasks 3 through 6.
- Produces: the original local development path restored and verified.

- [ ] **Step 1: Stop the local application process tree**

Use `Ctrl+C` in the foreground development console and verify the project Node processes exit.

- [ ] **Step 2: Restore the local `.env`**

```powershell
$backup = Get-ChildItem 'C:\work\workspace\waoowaoo-local-backups' -Directory -Filter 'trial-*' |
  Sort-Object LastWriteTime -Descending |
  ForEach-Object { Join-Path $_.FullName '.env.local-backup' } |
  Where-Object { Test-Path -LiteralPath $_ } |
  Select-Object -First 1
if (-not $backup) { throw 'No trial .env backup found; do not continue rollback.' }
Copy-Item -LiteralPath $backup -Destination 'C:\work\workspace\waoowaoo\.env' -Force
```

Expected: the newest verified trial backup is restored without printing its contents.

- [ ] **Step 3: Restart retained local infrastructure and application processes**

```powershell
Set-Location 'C:\work\workspace\waoowaoo'
docker compose up -d mysql redis minio
npm.cmd run dev
```

Expected: local storage initialization succeeds and the application returns to its pre-trial state.

- [ ] **Step 4: Verify rollback**

```powershell
curl.exe -sS -I --max-time 30 http://127.0.0.1:3000/
```

Expected: a `2xx` response or redirect, followed by successful login and access to representative existing media.
