# Windows Dev Data Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the stopped waoowaoo application data from Windows host `192.168.0.112` to the current Windows host `192.168.0.116`, run the current branch in host dev mode, and keep ComfyUI on `192.168.0.112:8878`.

**Architecture:** MySQL is migrated with a logical `mysqldump`, MinIO is migrated with `mc mirror`, and Redis starts empty. Next.js and all workers run on the current Windows host, while Docker hosts MySQL, Redis, and MinIO; ComfyUI remains a network provider on the old host.

**Tech Stack:** Windows PowerShell, RDP drive redirection, Docker Desktop 29.6.1, MySQL 8.0, Redis 7, MinIO, Node.js 22.14.0, npm, Prisma 6, Next.js 15, BullMQ, ComfyUI HTTP API.

## Global Constraints

- Source application downtime is allowed for the entire migration window.
- Discard every source Task in `queued` or `processing` state; preserve completed data and task history.
- Do not migrate Redis AOF, RDB, BullMQ jobs, or Docker Redis volumes.
- Do not migrate ComfyUI models, custom nodes, cache, input, output, or installation files.
- Keep ComfyUI on `192.168.0.112:8878`; allow TCP 8878 only from `192.168.0.116`.
- Preserve the source `API_ENCRYPTION_KEY`; preserve `NEXTAUTH_SECRET` during the initial cutover.
- Keep source MySQL and MinIO volumes intact until acceptance is complete.
- Store dumps and copied secrets under `C:\work\migration\waoowaoo-20260710`, outside the Git repository.
- Never print Windows, MySQL, MinIO, or provider secrets into logs or commit them to Git.
- Do not start the current worker until imported Task and GraphRun states have been normalized.

## File and State Map

- Create outside Git: `C:\work\migration\waoowaoo-20260710\source\waoowaoo.sql` — immutable source database dump.
- Create outside Git: `C:\work\migration\waoowaoo-20260710\source\waoowaoo.sql.sha256.txt` — dump checksum.
- Create outside Git: `C:\work\migration\waoowaoo-20260710\source-files\source.env` — protected copy of source environment settings.
- Create outside Git: `C:\work\migration\waoowaoo-20260710\source-files\project-copy` — source project copy excluding generated dependencies and logs.
- Create outside Git: `C:\work\migration\waoowaoo-20260710\inventory` — source and target verification reports.
- Create ignored local file: `C:\work\workspace\waoowaoo\.env` — current dev configuration derived from `source.env` and `.env.example`.
- Read: `C:\work\workspace\waoowaoo\prisma\schema.prisma` — target database schema.
- Read and execute: `C:\work\workspace\waoowaoo\prisma\migrations\20260613120000_migrate_default_video_model_to_bernini\migration.sql` — required data normalization.
- Do not modify project source code as part of the migration.

---

### Task 1: Prepare the Current Host and Migration Workspace

**Files:**
- Create outside Git: `C:\work\migration\waoowaoo-20260710\source`
- Create outside Git: `C:\work\migration\waoowaoo-20260710\source-files`
- Create outside Git: `C:\work\migration\waoowaoo-20260710\inventory`
- Read: `C:\work\workspace\waoowaoo\.nvmrc`

**Interfaces:**
- Consumes: Current Windows host `192.168.0.116` and Docker Desktop.
- Produces: A clean migration workspace and a Node.js 22.14.0 shell for later Prisma and dev commands.

- [ ] **Step 1: Verify the current repository and Docker daemon**

Run in PowerShell:

```powershell
Set-Location 'C:\work\workspace\waoowaoo'
git status --short --branch
git branch --show-current
docker version --format '{{.Client.Version}}|{{.Server.Version}}'
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
```

Expected: branch `codex/codex-image-generation`, a clean worktree, Docker client/server `29.6.1`, and no target waoowaoo containers.

- [ ] **Step 2: Create the migration directories outside Git**

```powershell
$MigrationRoot = 'C:\work\migration\waoowaoo-20260710'
New-Item -ItemType Directory -Force -Path `
  "$MigrationRoot\source", `
  "$MigrationRoot\source-files", `
  "$MigrationRoot\inventory" | Out-Null
Get-ChildItem $MigrationRoot
```

Expected: `source`, `source-files`, and `inventory` exist.

- [ ] **Step 3: Install nvm-windows if `nvm` is unavailable**

```powershell
if (-not (Get-Command nvm -ErrorAction SilentlyContinue)) {
  winget install --id CoreyButler.NVMforWindows --exact --accept-package-agreements --accept-source-agreements
}
```

Expected: winget reports a successful install. Close and reopen PowerShell before continuing if nvm was installed.

- [ ] **Step 4: Install and activate the repository Node version**

```powershell
nvm install 22.14.0
nvm use 22.14.0
node --version
npm --version
```

Expected: Node prints `v22.14.0`; npm is at least version 9.

- [ ] **Step 5: Record target preflight state**

```powershell
$MigrationRoot = 'C:\work\migration\waoowaoo-20260710'
@(
  "timestamp=$((Get-Date).ToString('o'))"
  "host=$env:COMPUTERNAME"
  "ip=192.168.0.116"
  "branch=$(git branch --show-current)"
  "commit=$(git rev-parse HEAD)"
  "node=$(node --version)"
  "npm=$(npm --version)"
  "docker=$(docker version --format '{{.Server.Version}}')"
) | Set-Content -Encoding UTF8 "$MigrationRoot\inventory\target-preflight.txt"
Get-Content "$MigrationRoot\inventory\target-preflight.txt"
```

Expected: every line has a concrete value and the commit matches the current branch.

### Task 2: Inventory and Copy Source Files Through RDP

**Files:**
- Create outside Git: `C:\work\migration\waoowaoo-20260710\source-files\source.env`
- Create outside Git: `C:\work\migration\waoowaoo-20260710\source-files\project-copy`
- Create outside Git: `C:\work\migration\waoowaoo-20260710\inventory\source-*.txt`

**Interfaces:**
- Consumes: RDP access to `192.168.0.112` and local C-drive redirection enabled in the RDP client.
- Produces: Source configuration, project files, commit state, container state, and rollback inventory on the current host.

- [ ] **Step 1: Open RDP with the current C drive redirected**

Run on the current host:

```powershell
mstsc /v:192.168.0.112
```

Before connecting, enable **Local Resources → More → Drives → C:**. Log in interactively; do not place the Windows password in a script.

Expected: `\\tsclient\C\work\migration\waoowaoo-20260710` is visible from the source RDP session.

- [ ] **Step 2: Discover the source Compose working directory**

Run in PowerShell on `192.168.0.112`:

```powershell
$SourceRepo = docker inspect waoowaoo-app --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}'
if (-not $SourceRepo) { throw 'Unable to resolve the source Compose working directory.' }
Set-Location $SourceRepo
Write-Output $SourceRepo
git status --short --branch
git rev-parse HEAD
```

Expected: `$SourceRepo` is an existing project directory and Git state is printed.

- [ ] **Step 3: Record source Git, Compose, containers, and volumes**

```powershell
$ClientInventory = '\\tsclient\C\work\migration\waoowaoo-20260710\inventory'
git status --short --branch | Set-Content -Encoding UTF8 "$ClientInventory\source-git-status.txt"
git rev-parse HEAD | Set-Content -Encoding ASCII "$ClientInventory\source-git-commit.txt"
docker compose ps --all | Set-Content -Encoding UTF8 "$ClientInventory\source-compose-ps.txt"
docker ps --all --format '{{json .}}' | Set-Content -Encoding UTF8 "$ClientInventory\source-containers.jsonl"
docker volume ls --format '{{json .}}' | Set-Content -Encoding UTF8 "$ClientInventory\source-volumes.jsonl"
Get-FileHash -Algorithm SHA256 '.env' | Format-List | Set-Content -Encoding UTF8 "$ClientInventory\source-env-hash.txt"
```

Expected: five inventory files exist on the redirected current-host drive; secret values are not printed.

- [ ] **Step 4: Copy the source environment file securely**

```powershell
$ClientFiles = '\\tsclient\C\work\migration\waoowaoo-20260710\source-files'
Copy-Item -LiteralPath '.env' -Destination "$ClientFiles\source.env" -Force
Get-Item "$ClientFiles\source.env" | Select-Object FullName,Length,LastWriteTime
```

Expected: `source.env` exists outside Git and has nonzero length.

- [ ] **Step 5: Copy project and custom files without generated directories**

```powershell
$ClientProjectCopy = '\\tsclient\C\work\migration\waoowaoo-20260710\source-files\project-copy'
robocopy $SourceRepo $ClientProjectCopy /E /COPY:DAT /DCOPY:DAT /R:2 /W:2 `
  /XD '.git' 'node_modules' '.next' 'docker-logs' `
  /XF '*.log'
$RobocopyExit = $LASTEXITCODE
if ($RobocopyExit -ge 8) { throw "robocopy failed with exit code $RobocopyExit" }
```

Expected: robocopy exit code is between 0 and 7; `.env`, scripts, and `data` are present in `project-copy`.

### Task 3: Freeze the Source Application and Record Data Baselines

**Files:**
- Create outside Git: `C:\work\migration\waoowaoo-20260710\inventory\source-db-counts.txt`
- Create outside Git: `C:\work\migration\waoowaoo-20260710\inventory\source-task-statuses.txt`

**Interfaces:**
- Consumes: Source Compose project discovered in Task 2.
- Produces: A write-frozen source with MySQL, MinIO, and ComfyUI still available.

- [ ] **Step 1: Stop only the source application container**

Run on `192.168.0.112` from `$SourceRepo`:

```powershell
docker compose stop app
docker compose ps --all
```

Expected: `waoowaoo-app` is stopped; `waoowaoo-mysql`, `waoowaoo-redis`, and `waoowaoo-minio` remain running.

- [ ] **Step 2: Verify the old application no longer accepts requests**

Run on the current host:

```powershell
Test-NetConnection 192.168.0.112 -Port 13000 -InformationLevel Quiet
Test-NetConnection 192.168.0.112 -Port 13306 -InformationLevel Quiet
Test-NetConnection 192.168.0.112 -Port 19000 -InformationLevel Quiet
```

Expected: port 13000 is `False`; ports 13306 and 19000 are `True`.

- [ ] **Step 3: Read the source MySQL password without logging it**

Run on the current host. Enter the value from the protected `source.env` or source Compose configuration:

```powershell
function Read-SecretText([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
$env:MYSQL_PWD = Read-SecretText 'Source MySQL root password'
```

Expected: `$env:MYSQL_PWD` is nonempty; its value is not printed.

- [ ] **Step 4: Record exact source counts for critical tables**

```powershell
$MigrationRoot = 'C:\work\migration\waoowaoo-20260710'
$CountSql = @"
SELECT 'user' AS table_name, COUNT(*) AS row_count FROM user
UNION ALL SELECT 'projects', COUNT(*) FROM projects
UNION ALL SELECT 'novel_promotion_projects', COUNT(*) FROM novel_promotion_projects
UNION ALL SELECT 'novel_promotion_episodes', COUNT(*) FROM novel_promotion_episodes
UNION ALL SELECT 'novel_promotion_storyboards', COUNT(*) FROM novel_promotion_storyboards
UNION ALL SELECT 'novel_promotion_panels', COUNT(*) FROM novel_promotion_panels
UNION ALL SELECT 'novel_promotion_voice_lines', COUNT(*) FROM novel_promotion_voice_lines
UNION ALL SELECT 'media_objects', COUNT(*) FROM media_objects
UNION ALL SELECT 'tasks', COUNT(*) FROM tasks;
"@
docker run --rm -e MYSQL_PWD mysql:8.0 mysql `
  -h192.168.0.112 -P13306 -uroot -N -B waoowaoo -e $CountSql |
  Set-Content -Encoding UTF8 "$MigrationRoot\inventory\source-db-counts.txt"
docker run --rm -e MYSQL_PWD mysql:8.0 mysql `
  -h192.168.0.112 -P13306 -uroot -N -B waoowaoo `
  -e "SELECT status,COUNT(*) FROM tasks GROUP BY status ORDER BY status" |
  Set-Content -Encoding UTF8 "$MigrationRoot\inventory\source-task-statuses.txt"
Get-Content "$MigrationRoot\inventory\source-db-counts.txt"
Get-Content "$MigrationRoot\inventory\source-task-statuses.txt"
```

Expected: both files contain concrete counts. Preserve them unchanged for target comparison.

### Task 4: Export and Verify the Source MySQL Database

**Files:**
- Create outside Git: `C:\work\migration\waoowaoo-20260710\source\waoowaoo.sql`
- Create outside Git: `C:\work\migration\waoowaoo-20260710\source\waoowaoo.sql.sha256.txt`

**Interfaces:**
- Consumes: Frozen source MySQL and `$env:MYSQL_PWD` from Task 3.
- Produces: An immutable, checksummed MySQL logical dump.

- [ ] **Step 1: Export through a MySQL 8 container directly into the migration directory**

```powershell
$MigrationRoot = 'C:\work\migration\waoowaoo-20260710'
docker run --rm -e MYSQL_PWD -v "${MigrationRoot}:/backup" mysql:8.0 sh -c `
  'mysqldump -h192.168.0.112 -P13306 -uroot --single-transaction --quick --routines --triggers --events --hex-blob --set-gtid-purged=OFF --no-tablespaces --default-character-set=utf8mb4 --databases waoowaoo > /backup/source/waoowaoo.sql'
```

Expected: exit code 0 and `waoowaoo.sql` has nonzero length.

- [ ] **Step 2: Calculate and store the dump checksum**

```powershell
$Dump = 'C:\work\migration\waoowaoo-20260710\source\waoowaoo.sql'
$Hash = Get-FileHash -Algorithm SHA256 -LiteralPath $Dump
"$($Hash.Hash)  $($Hash.Path)" | Set-Content -Encoding ASCII "$Dump.sha256.txt"
Get-Item $Dump | Select-Object FullName,Length,LastWriteTime
Get-Content "$Dump.sha256.txt"
```

Expected: the dump is nonempty and a 64-character SHA-256 is recorded.

- [ ] **Step 3: Verify the dump contains schema and data**

```powershell
$Dump = 'C:\work\migration\waoowaoo-20260710\source\waoowaoo.sql'
Select-String -LiteralPath $Dump -Pattern 'CREATE TABLE `user`','CREATE TABLE `projects`','CREATE TABLE `media_objects`','INSERT INTO `projects`' | Select-Object -First 20
```

Expected: CREATE TABLE statements are found; `INSERT INTO projects` is found when the source contains projects.

### Task 5: Start Target Infrastructure and Import MySQL

**Files:**
- Create ignored Docker volumes through `docker-compose.yml`.
- Read: `C:\work\workspace\waoowaoo\docker-compose.yml`
- Read: `C:\work\migration\waoowaoo-20260710\source\waoowaoo.sql`

**Interfaces:**
- Consumes: Verified dump from Task 4 and current repository Compose file.
- Produces: Imported target MySQL plus empty Redis and empty MinIO services.

- [ ] **Step 1: Start only MySQL, Redis, and MinIO on the current host**

```powershell
Set-Location 'C:\work\workspace\waoowaoo'
docker compose up mysql redis minio -d
docker compose ps
```

Expected: `waoowaoo-mysql`, `waoowaoo-redis`, and `waoowaoo-minio` become healthy; no `waoowaoo-app` container is started.

- [ ] **Step 2: Read the target MySQL password without logging it**

```powershell
function Read-SecretText([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
$env:MYSQL_PWD = Read-SecretText 'Target MySQL root password from docker-compose.yml'
```

Expected: `$env:MYSQL_PWD` is nonempty and not printed.

- [ ] **Step 3: Import the dump using a mounted MySQL client container**

```powershell
$MigrationRoot = 'C:\work\migration\waoowaoo-20260710'
docker run --rm -e MYSQL_PWD -v "${MigrationRoot}:/backup:ro" mysql:8.0 sh -c `
  'mysql -hhost.docker.internal -P13306 -uroot < /backup/source/waoowaoo.sql'
```

Expected: exit code 0 and database `waoowaoo` exists on the target.

- [ ] **Step 4: Verify target tables are readable before normalization**

```powershell
docker run --rm -e MYSQL_PWD mysql:8.0 mysql `
  -hhost.docker.internal -P13306 -uroot -N -B `
  -e "SELECT COUNT(*) FROM waoowaoo.projects; SELECT COUNT(*) FROM waoowaoo.media_objects; SELECT status,COUNT(*) FROM waoowaoo.tasks GROUP BY status ORDER BY status;"
```

Expected: project and media counts are returned; queued/processing tasks may still be present at this point.

### Task 6: Cancel Historical Active Work and Align the Prisma Schema

**Files:**
- Create ignored local file: `C:\work\workspace\waoowaoo\.env`
- Read: `C:\work\workspace\waoowaoo\.env.example`
- Read: `C:\work\workspace\waoowaoo\prisma\schema.prisma`
- Execute: `C:\work\workspace\waoowaoo\prisma\migrations\20260613120000_migrate_default_video_model_to_bernini\migration.sql`

**Interfaces:**
- Consumes: Imported target database and protected `source.env`.
- Produces: A current-schema database with no recoverable old tasks and a valid local dev `.env`.

- [ ] **Step 1: Create the target `.env` from the protected source copy**

```powershell
Copy-Item -LiteralPath 'C:\work\migration\waoowaoo-20260710\source-files\source.env' `
  -Destination 'C:\work\workspace\waoowaoo\.env' -Force
```

Open `.env` in a local editor and apply these exact endpoint changes while retaining secret values:

- Change only the database host/port to `localhost:13306` in `DATABASE_URL`.
- Set `REDIS_HOST=127.0.0.1` and `REDIS_PORT=16379`.
- Set `MINIO_ENDPOINT=http://localhost:19000`.
- Set `NEXTAUTH_URL=http://192.168.0.116:3000`.
- Set `INTERNAL_APP_URL=http://127.0.0.1:3000`.
- Retain the source values of `API_ENCRYPTION_KEY` and `NEXTAUTH_SECRET` unchanged.
- Set `QUEUE_CONCURRENCY_IMAGE=1` and `QUEUE_CONCURRENCY_VIDEO=1` for dev mode.

Expected: `.env` exists, is ignored by Git, and `git status --short` does not list it.

- [ ] **Step 2: Cancel imported active Tasks, GraphRuns, and GraphSteps before worker startup**

```powershell
function Read-SecretText([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
if (-not $env:MYSQL_PWD) {
  $env:MYSQL_PWD = Read-SecretText 'Target MySQL root password from docker-compose.yml'
}
$CancelSql = @"
START TRANSACTION;
UPDATE waoowaoo.tasks
SET status='canceled',
    errorCode='MIGRATION_CANCELED',
    errorMessage='Canceled during migration from 192.168.0.112',
    finishedAt=COALESCE(finishedAt,NOW()),
    startedAt=NULL,
    heartbeatAt=NULL,
    externalId=NULL
WHERE status IN ('queued','processing');
UPDATE waoowaoo.graph_runs
SET status='canceled',
    errorCode='MIGRATION_CANCELED',
    errorMessage='Canceled during migration from 192.168.0.112',
    cancelRequestedAt=COALESCE(cancelRequestedAt,NOW()),
    finishedAt=COALESCE(finishedAt,NOW()),
    leaseOwner=NULL,
    leaseExpiresAt=NULL,
    heartbeatAt=NULL
WHERE status IN ('queued','running','canceling');
UPDATE waoowaoo.graph_steps
SET status='canceled',
    finishedAt=COALESCE(finishedAt,NOW()),
    lastErrorCode='MIGRATION_CANCELED',
    lastErrorMessage='Canceled during migration from 192.168.0.112'
WHERE status IN ('pending','running');
COMMIT;
"@
docker run --rm -e MYSQL_PWD mysql:8.0 mysql `
  -hhost.docker.internal -P13306 -uroot -e $CancelSql
```

Expected: exit code 0.

- [ ] **Step 3: Verify no imported active state remains**

```powershell
docker run --rm -e MYSQL_PWD mysql:8.0 mysql `
  -hhost.docker.internal -P13306 -uroot -N -B `
  -e "SELECT COUNT(*) FROM waoowaoo.tasks WHERE status IN ('queued','processing'); SELECT COUNT(*) FROM waoowaoo.graph_runs WHERE status IN ('queued','running','canceling'); SELECT COUNT(*) FROM waoowaoo.graph_steps WHERE status IN ('pending','running');"
```

Expected: three lines, all `0`.

- [ ] **Step 4: Install dependencies and generate Prisma Client**

```powershell
Set-Location 'C:\work\workspace\waoowaoo'
npm ci
npx prisma generate
```

Expected: npm exits 0 and Prisma Client generation succeeds.

- [ ] **Step 5: Align the imported schema to the current branch**

```powershell
npx prisma db push
```

Expected: Prisma reports that the database is in sync with `prisma/schema.prisma` without resetting data.

- [ ] **Step 6: Apply the Bernini default-model data migration explicitly**

```powershell
$RepoRoot = 'C:\work\workspace\waoowaoo'
docker run --rm -e MYSQL_PWD -v "${RepoRoot}:/repo:ro" mysql:8.0 sh -c `
  'mysql -hhost.docker.internal -P13306 -uroot waoowaoo < /repo/prisma/migrations/20260613120000_migrate_default_video_model_to_bernini/migration.sql'
```

Expected: exit code 0.

- [ ] **Step 7: Verify required schema and model normalization**

```powershell
docker run --rm -e MYSQL_PWD mysql:8.0 mysql `
  -hhost.docker.internal -P13306 -uroot -N -B `
  -e "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='waoowaoo' AND table_name='novel_promotion_panels' AND column_name='videoModel'; SELECT COUNT(*) FROM waoowaoo.user_preferences WHERE videoModel='comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2'; SELECT COUNT(*) FROM waoowaoo.novel_promotion_projects WHERE videoModel='comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2';"
```

Expected: output is `1`, `0`, `0`.

### Task 7: Mirror MinIO and Verify Object Parity

**Files:**
- Create outside Git: `C:\work\migration\waoowaoo-20260710\inventory\source-minio-stats.json`
- Create outside Git: `C:\work\migration\waoowaoo-20260710\inventory\target-minio-stats.json`

**Interfaces:**
- Consumes: Running source MinIO at `192.168.0.112:19000`, running target MinIO at `host.docker.internal:19000`, and credentials from protected environments.
- Produces: A target `waoowaoo` bucket with source object parity.

- [ ] **Step 1: Read source and target MinIO credentials without printing secrets**

```powershell
function Read-SecretText([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
$env:SRC_MINIO_ACCESS = Read-Host 'Source MinIO access key'
$env:SRC_MINIO_SECRET = Read-SecretText 'Source MinIO secret key'
$env:DST_MINIO_ACCESS = Read-Host 'Target MinIO access key'
$env:DST_MINIO_SECRET = Read-SecretText 'Target MinIO secret key'
```

Expected: all four environment variables are nonempty; secret values are not printed.

- [ ] **Step 2: Record the source bucket size and object count**

```powershell
$MigrationRoot = 'C:\work\migration\waoowaoo-20260710'
$SourceObjectLines = docker run --rm --entrypoint /bin/sh `
  -e SRC_MINIO_ACCESS -e SRC_MINIO_SECRET `
  minio/mc:latest -c `
  'mc alias set source http://192.168.0.112:19000 "$SRC_MINIO_ACCESS" "$SRC_MINIO_SECRET" >/dev/null && mc ls --recursive --json source/waoowaoo'
$SourceMeasure = $SourceObjectLines | ConvertFrom-Json | Measure-Object -Property size -Sum
[pscustomobject]@{ Objects=$SourceMeasure.Count; Bytes=[long]$SourceMeasure.Sum } |
  ConvertTo-Json -Compress |
  Set-Content -Encoding UTF8 "$MigrationRoot\inventory\source-minio-stats.json"
Get-Content "$MigrationRoot\inventory\source-minio-stats.json"
```

Expected: JSON contains nonnegative `Objects` and `Bytes` values.

- [ ] **Step 3: Mirror source objects into the target bucket**

```powershell
docker run --rm --entrypoint /bin/sh `
  -e SRC_MINIO_ACCESS -e SRC_MINIO_SECRET `
  -e DST_MINIO_ACCESS -e DST_MINIO_SECRET `
  minio/mc:latest -c `
  'mc alias set source http://192.168.0.112:19000 "$SRC_MINIO_ACCESS" "$SRC_MINIO_SECRET" >/dev/null && mc alias set target http://host.docker.internal:19000 "$DST_MINIO_ACCESS" "$DST_MINIO_SECRET" >/dev/null && mc mb --ignore-existing target/waoowaoo && mc mirror --preserve --overwrite source/waoowaoo target/waoowaoo'
```

Expected: mirror exits 0; no `--remove` option is used.

- [ ] **Step 4: Run a second mirror pass to prove convergence**

Run the exact Step 3 command again.

Expected: exit code 0 with no new object transfers or only metadata reconciliation.

- [ ] **Step 5: Record target bucket size and compare source/target reports**

```powershell
$MigrationRoot = 'C:\work\migration\waoowaoo-20260710'
$TargetObjectLines = docker run --rm --entrypoint /bin/sh `
  -e DST_MINIO_ACCESS -e DST_MINIO_SECRET `
  minio/mc:latest -c `
  'mc alias set target http://host.docker.internal:19000 "$DST_MINIO_ACCESS" "$DST_MINIO_SECRET" >/dev/null && mc ls --recursive --json target/waoowaoo'
$TargetMeasure = $TargetObjectLines | ConvertFrom-Json | Measure-Object -Property size -Sum
[pscustomobject]@{ Objects=$TargetMeasure.Count; Bytes=[long]$TargetMeasure.Sum } |
  ConvertTo-Json -Compress |
  Set-Content -Encoding UTF8 "$MigrationRoot\inventory\target-minio-stats.json"
Compare-Object `
  (Get-Content "$MigrationRoot\inventory\source-minio-stats.json") `
  (Get-Content "$MigrationRoot\inventory\target-minio-stats.json")
```

Expected: `Compare-Object` prints no differences.

### Task 8: Expose Source ComfyUI Only to the Current Host

**Files:**
- Modify on source host: Existing ComfyUI launch script or shortcut.
- Create on source host: Windows Firewall rule `ComfyUI 8878 from 192.168.0.116`.

**Interfaces:**
- Consumes: Existing ComfyUI installation on `192.168.0.112`.
- Produces: Reachable ComfyUI HTTP API at `http://192.168.0.112:8878`, restricted to `192.168.0.116`.

- [ ] **Step 1: Identify the existing ComfyUI launch command through RDP**

Run on `192.168.0.112`:

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -match 'ComfyUI|main\.py' } |
  Select-Object ProcessId,ExecutablePath,CommandLine |
  Format-List
```

Expected: the ComfyUI Python executable, working directory, or launch script is identifiable.

- [ ] **Step 2: Update the existing launch script to include LAN listening**

Retain all existing model paths and arguments. Ensure the effective ComfyUI command includes exactly these network arguments:

```text
--listen 0.0.0.0 --port 8878
```

Expected: ComfyUI logs report a listener on port 8878, not only `127.0.0.1`.

- [ ] **Step 3: Create a source-restricted firewall rule**

Run in an elevated PowerShell on `192.168.0.112`:

```powershell
Get-NetFirewallRule -DisplayName 'ComfyUI 8878 from 192.168.0.116' -ErrorAction SilentlyContinue |
  Remove-NetFirewallRule
New-NetFirewallRule `
  -DisplayName 'ComfyUI 8878 from 192.168.0.116' `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort 8878 `
  -RemoteAddress 192.168.0.116
```

Expected: one enabled inbound allow rule exists for TCP 8878 and remote address `192.168.0.116`.

- [ ] **Step 4: Restart ComfyUI and verify from the current host**

Run on `192.168.0.116`:

```powershell
Test-NetConnection 192.168.0.112 -Port 8878 -InformationLevel Quiet
(Invoke-WebRequest -UseBasicParsing -Uri 'http://192.168.0.112:8878/system_stats' -TimeoutSec 10).StatusCode
(Invoke-WebRequest -UseBasicParsing -Uri 'http://192.168.0.112:8878/queue' -TimeoutSec 10).StatusCode
```

Expected: TCP result `True`; both HTTP responses are `200`.

### Task 9: Validate the Application Before Starting Workers

**Files:**
- Read: `C:\work\workspace\waoowaoo\package.json`
- Read: `C:\work\workspace\waoowaoo\tests`

**Interfaces:**
- Consumes: Imported schema-aligned MySQL, mirrored MinIO, fresh Redis, dependencies, and reachable ComfyUI.
- Produces: Evidence that the current branch is safe to start in dev mode.

- [ ] **Step 1: Run static validation**

```powershell
Set-Location 'C:\work\workspace\waoowaoo'
npm run typecheck
npm run lint:all
```

Expected: both commands exit 0.

- [ ] **Step 2: Run migration- and provider-focused tests**

```powershell
npx vitest run `
  tests/unit/migrations/bernini-default-video-model-migration.test.ts `
  tests/unit/providers/codex-client.test.ts `
  tests/unit/generators/codex-image.test.ts `
  tests/unit/generators/comfyui-video.test.ts `
  tests/unit/providers/comfyui-workflow-registry.test.ts `
  tests/unit/worker/video-worker.test.ts `
  tests/integration/api/specific/user-models-codex.test.ts
```

Expected: all listed test files pass with zero failures.

- [ ] **Step 3: Compare target critical table counts with the source baseline**

```powershell
$MigrationRoot = 'C:\work\migration\waoowaoo-20260710'
function Read-SecretText([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
if (-not $env:MYSQL_PWD) {
  $env:MYSQL_PWD = Read-SecretText 'Target MySQL root password from docker-compose.yml'
}
$CountSql = @"
SELECT 'user' AS table_name, COUNT(*) AS row_count FROM user
UNION ALL SELECT 'projects', COUNT(*) FROM projects
UNION ALL SELECT 'novel_promotion_projects', COUNT(*) FROM novel_promotion_projects
UNION ALL SELECT 'novel_promotion_episodes', COUNT(*) FROM novel_promotion_episodes
UNION ALL SELECT 'novel_promotion_storyboards', COUNT(*) FROM novel_promotion_storyboards
UNION ALL SELECT 'novel_promotion_panels', COUNT(*) FROM novel_promotion_panels
UNION ALL SELECT 'novel_promotion_voice_lines', COUNT(*) FROM novel_promotion_voice_lines
UNION ALL SELECT 'media_objects', COUNT(*) FROM media_objects
UNION ALL SELECT 'tasks', COUNT(*) FROM tasks;
"@
docker run --rm -e MYSQL_PWD mysql:8.0 mysql `
  -hhost.docker.internal -P13306 -uroot -N -B waoowaoo -e $CountSql |
  Set-Content -Encoding UTF8 "$MigrationRoot\inventory\target-db-counts.txt"
Compare-Object `
  (Get-Content "$MigrationRoot\inventory\source-db-counts.txt") `
  (Get-Content "$MigrationRoot\inventory\target-db-counts.txt")
```

Expected: `Compare-Object` prints no differences.

### Task 10: Start Dev Mode, Configure ComfyUI, and Perform Acceptance

**Files:**
- Read ignored local file: `C:\work\workspace\waoowaoo\.env`
- Persist through application UI: User Provider configuration in imported MySQL.
- Create outside Git: `C:\work\migration\waoowaoo-20260710\inventory\acceptance.txt`

**Interfaces:**
- Consumes: All verified target infrastructure and reachable source ComfyUI.
- Produces: Running dev application on `192.168.0.116`, accepted data, and a rollback decision.

- [ ] **Step 1: Start the full host dev process**

```powershell
Set-Location 'C:\work\workspace\waoowaoo'
npm run dev
```

Expected: Next.js listens on port 3000, Bull Board listens on 3010, and four workers report ready.

- [ ] **Step 2: Configure the imported ComfyUI Provider through the UI**

Open `http://192.168.0.116:3000/zh/profile` and set the ComfyUI Provider base URL to:

```text
http://192.168.0.112:8878
```

Save and run the built-in Provider connection test.

Expected: configuration saves and the connection test succeeds.

- [ ] **Step 3: Verify imported user and media data**

In the application:

1. Log in with an imported user.
2. Open at least one imported project and episode.
3. Open one character image, one location image, one storyboard image, one video, and one audio asset.
4. Confirm API configuration values can be decrypted and their connection tests do not report decryption errors.

Expected: every selected entity loads and every sampled media object is accessible.

- [ ] **Step 4: Run new task smoke tests**

Submit, in order:

1. One small text analysis task.
2. One Codex test image task.
3. One small ComfyUI image or video task through `192.168.0.112:8878`.

Expected: each task transitions queued → processing → completed, appears in Bull Board, and produces accessible output.

- [ ] **Step 5: Record acceptance evidence**

```powershell
$MigrationRoot = 'C:\work\migration\waoowaoo-20260710'
@(
  "acceptedAt=$((Get-Date).ToString('o'))"
  "targetHost=192.168.0.116"
  "sourceComfyUi=http://192.168.0.112:8878"
  "branch=$(git branch --show-current)"
  "commit=$(git rev-parse HEAD)"
  "dbCounts=matched"
  "minio=matched"
  "activeHistoricalTasks=0"
  "login=passed"
  "mediaSamples=passed"
  "codexSmoke=passed"
  "comfyuiSmoke=passed"
) | Set-Content -Encoding UTF8 "$MigrationRoot\inventory\acceptance.txt"
Get-Content "$MigrationRoot\inventory\acceptance.txt"
```

Expected: every acceptance field records `matched`, `0`, or `passed`.

### Task 11: Secure the Old Host or Roll Back

**Files:**
- Preserve outside Git: All migration inventory and the source SQL dump.
- Preserve on source host: Original MySQL and MinIO volumes.

**Interfaces:**
- Consumes: Acceptance result from Task 10.
- Produces: Either a secured ComfyUI-only old host or a restored old application.

- [ ] **Step 1: If acceptance passed, stop old data services and close exposed ports**

Run through RDP on `192.168.0.112` from the source project directory:

```powershell
docker compose stop mysql redis minio
```

Do not run `docker compose down -v`, do not delete volumes, and do not disable unrelated Windows firewall rules.

Expected: ports 13306, 16379, 19000, and 19001 are no longer reachable from `192.168.0.116`; port 8878 remains reachable.

- [ ] **Step 2: Verify final old-host exposure from the current host**

```powershell
foreach ($port in 13306,16379,19000,19001,8878) {
  [pscustomobject]@{
    Port = $port
    Open = Test-NetConnection 192.168.0.112 -Port $port -InformationLevel Quiet
  }
}
```

Expected: 13306/16379/19000/19001 are `False`; 8878 is `True`.

- [ ] **Step 3: If any acceptance criterion failed, execute rollback instead of Step 1**

On the current host:

```powershell
Set-Location 'C:\work\workspace\waoowaoo'
Get-Process node -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,StartTime
docker compose stop mysql redis minio
```

Stop the identified dev Node processes through the terminal running `npm run dev`. Then, through RDP on the source host:

```powershell
Set-Location $SourceRepo
docker compose start mysql redis minio app
docker compose ps
```

Expected: current target services are stopped, source services return healthy, and the source app is available again without restoring from the dump.

- [ ] **Step 4: Preserve rollback material**

```powershell
Get-Item `
  'C:\work\migration\waoowaoo-20260710\source\waoowaoo.sql', `
  'C:\work\migration\waoowaoo-20260710\source\waoowaoo.sql.sha256.txt', `
  'C:\work\migration\waoowaoo-20260710\inventory\acceptance.txt' |
  Select-Object FullName,Length,LastWriteTime
```

Expected: dump, checksum, and acceptance evidence remain present. Retain them until at least one complete production-like generation workflow succeeds on the target.
