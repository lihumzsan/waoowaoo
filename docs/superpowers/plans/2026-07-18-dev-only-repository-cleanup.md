# Dev-Only Repository Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the application deployment surface while retaining a safe, infrastructure-only Docker Compose stack for host-based development.

**Architecture:** Next.js, workers, watchdog, Bull Board, and warmup continue to run on the host through `npm run dev`. Docker Compose exposes only MySQL, Redis, and MinIO on loopback addresses, and existing test bootstrap continues to use those services with its derived `_test` database.

**Tech Stack:** Node.js, npm scripts, Next.js 15, Vitest, Docker Compose, MySQL 8, Redis 7, MinIO.

## Global Constraints

- Preserve the existing Docker volume keys `mysql_data`, `redis_data`, and `minio_data`.
- Never run `docker compose down -v` or another volume-deleting command.
- Do not modify `.env`, Prisma schema, business code, API behavior, ComfyUI workflows, or historical Superpowers documents.
- Bind all published development infrastructure ports to `127.0.0.1`.
- Keep `npm run dev`, all `dev:*` processes, `storage:init`, `build`, lint, typecheck, and test commands.
- Do not add a replacement deployment or image-publishing path.
- Do not remove npm dependencies without repository-wide evidence plus verification.

---

### Task 1: Add the dev-only repository contract

**Files:**
- Create: `tests/unit/config/dev-only-repository.test.ts`
- Modify: `tests/unit/scripts/dev-warmup-wiring.test.ts`

**Interfaces:**
- Consumes: root `package.json`, `docker-compose.yml`, and deployment file paths.
- Produces: an executable contract for the infrastructure-only Compose topology and development-only npm scripts.

- [ ] **Step 1: Add the failing repository contract test**

Create `tests/unit/config/dev-only-repository.test.ts` with:

```ts
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

const root = process.cwd()

function readRootFile(path: string) {
  return readFileSync(join(root, path), 'utf8')
}

describe('dev-only repository contract', () => {
  test('Docker Compose contains local infrastructure only', () => {
    const compose = readRootFile('docker-compose.yml')

    expect(compose).toMatch(/^services:/)
    expect(compose).toMatch(/^  mysql:/m)
    expect(compose).toMatch(/^  redis:/m)
    expect(compose).toMatch(/^  minio:/m)
    expect(compose).not.toMatch(/^  app:/m)
    expect(compose).not.toContain('container_name:')
    expect(compose).not.toContain('restart:')
    expect(compose).toContain('"127.0.0.1:13306:3306"')
    expect(compose).toContain('"127.0.0.1:16379:6379"')
    expect(compose).toContain('"127.0.0.1:19000:9000"')
    expect(compose).toContain('"127.0.0.1:19001:9001"')
    expect(compose).toMatch(/^  mysql_data:$/m)
    expect(compose).toMatch(/^  redis_data:$/m)
    expect(compose).toMatch(/^  minio_data:$/m)
  })

  test('application deployment files are absent', () => {
    for (const path of [
      'Dockerfile',
      '.dockerignore',
      '.github/workflows/docker-publish.yml',
      'caddyfile',
      'docker-compose.test.yml',
    ]) {
      expect(existsSync(join(root, path)), path).toBe(false)
    }
  })

  test('npm scripts expose development infrastructure without production start commands', () => {
    const packageJson = JSON.parse(readRootFile('package.json')) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts['infra:up']).toBe('docker compose up -d --wait')
    expect(packageJson.scripts['infra:down']).toBe('docker compose down')
    expect(packageJson.scripts['infra:logs']).toBe('docker compose logs -f')
    expect(packageJson.scripts['infra:status']).toBe('docker compose ps')
    expect(packageJson.scripts.start).toBeUndefined()
    expect(packageJson.scripts['start:next']).toBeUndefined()
    expect(packageJson.scripts['start:worker']).toBeUndefined()
    expect(packageJson.scripts['start:watchdog']).toBeUndefined()
    expect(packageJson.scripts['start:board']).toBeUndefined()
  })
})
```

- [ ] **Step 2: Tighten the existing warmup wiring contract**

Replace the final assertion in `tests/unit/scripts/dev-warmup-wiring.test.ts`:

```ts
  expect(packageJson.scripts.start).not.toContain('dev:warmup')
```

with:

```ts
  expect(packageJson.scripts.start).toBeUndefined()
```

- [ ] **Step 3: Run the tests to verify the current deployment surface violates them**

Run:

```bash
npx vitest run tests/unit/config/dev-only-repository.test.ts tests/unit/scripts/dev-warmup-wiring.test.ts
```

Expected: FAIL because `app`, production scripts, and deployment files still exist.

---

### Task 2: Implement the infrastructure-only runtime boundary

**Files:**
- Modify: `docker-compose.yml`
- Modify: `package.json`
- Delete: `Dockerfile`
- Delete: `.dockerignore`
- Delete: `.github/workflows/docker-publish.yml`
- Delete: `caddyfile`
- Delete: `docker-compose.test.yml`
- Test: `tests/unit/config/dev-only-repository.test.ts`
- Test: `tests/unit/scripts/dev-warmup-wiring.test.ts`

**Interfaces:**
- Consumes: the contract introduced in Task 1 and current `.env.example` port values.
- Produces: `infra:up`, `infra:down`, `infra:logs`, `infra:status`, and a three-service Compose stack.

- [ ] **Step 1: Replace Compose with the exact development infrastructure configuration**

Set `docker-compose.yml` to:

```yaml
services:
  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: waoowaoo123
      MYSQL_DATABASE: waoowaoo
      MYSQL_ROOT_HOST: "%"
    ports:
      - "127.0.0.1:13306:3306"
    volumes:
      - mysql_data:/var/lib/mysql
    command:
      - "--default-authentication-plugin=mysql_native_password"
      - "--sql_mode=STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION"
    healthcheck:
      test: ["CMD-SHELL", "mysqladmin ping -h 127.0.0.1 -uroot -pwaoowaoo123"]
      interval: 5s
      timeout: 5s
      retries: 30
      start_period: 15s

  redis:
    image: redis:7-alpine
    ports:
      - "127.0.0.1:16379:6379"
    volumes:
      - redis_data:/data
    command: ["redis-server", "--appendonly", "yes"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 30
      start_period: 5s

  minio:
    image: minio/minio:RELEASE.2025-02-28T09-55-16Z
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    command: server /data --console-address ":9001"
    ports:
      - "127.0.0.1:19000:9000"
      - "127.0.0.1:19001:9001"
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://127.0.0.1:9000/minio/health/live"]
      interval: 5s
      timeout: 5s
      retries: 30
      start_period: 10s

volumes:
  mysql_data:
  redis_data:
  minio_data:
```

- [ ] **Step 2: Replace production scripts with infrastructure helpers**

After `dev:turbo` in `package.json`, use:

```json
    "infra:up": "docker compose up -d --wait",
    "infra:down": "docker compose down",
    "infra:logs": "docker compose logs -f",
    "infra:status": "docker compose ps",
    "build": "prisma generate && next build",
    "build:turbo": "next build --turbopack",
    "storage:init": "tsx --env-file=.env src/lib/storage/init.ts",
```

Remove `start`, `start:next`, `start:worker`, `start:watchdog`, and `start:board`. Do not modify any other script or dependency.

- [ ] **Step 3: Delete deployment-only files with the patch tool**

Delete exactly the five deployment files and disconnected test Compose file listed in this task. Do not delete Docker volumes or runtime data directories.

- [ ] **Step 4: Validate the Compose model and targeted contracts**

Run:

```bash
docker compose config
npx vitest run tests/unit/config/dev-only-repository.test.ts tests/unit/scripts/dev-warmup-wiring.test.ts
```

Expected: Compose renders exactly `mysql`, `redis`, and `minio`; both test files PASS.

- [ ] **Step 5: Commit the runtime boundary**

```bash
git add docker-compose.yml package.json tests/unit/config/dev-only-repository.test.ts tests/unit/scripts/dev-warmup-wiring.test.ts Dockerfile .dockerignore .github/workflows/docker-publish.yml caddyfile docker-compose.test.yml
git commit -m "refactor: keep Docker for development infrastructure only"
```

---

### Task 3: Remove tracked verification output

**Files:**
- Modify: `.gitignore`
- Delete: `.codex-artifacts/**`

**Interfaces:**
- Consumes: the confirmed list of 31 tracked verification files.
- Produces: a repository where regenerated Codex verification evidence remains local and ignored.

- [ ] **Step 1: Add the generated directory ignore rule**

Add this line alongside the other IDE and AI tool paths in `.gitignore`:

```gitignore
.codex-artifacts/
```

Remove this obsolete application-container log rule:

```gitignore
docker-logs/
```

- [ ] **Step 2: Delete only the tracked verification artifacts**

Run this exact, recoverable Git deletion for the tracked directory:

```bash
git rm -r -- .codex-artifacts
```

Do not delete `.artifacts/`, `.codex-run/`, or `.codex-ui-verification/` rules.

- [ ] **Step 3: Verify deletion and ignore behavior**

Run:

```bash
test ! -e .codex-artifacts
git check-ignore .codex-artifacts/example.png
git diff --check
```

Expected: the working-tree directory is gone, a regenerated example path is ignored, and the diff has no whitespace errors.

- [ ] **Step 4: Commit repository hygiene**

```bash
git add .gitignore
git commit -m "chore: remove generated verification artifacts"
test -z "$(git ls-files .codex-artifacts)"
```

---

### Task 4: Rewrite the supported development documentation

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `README_en.md`

**Interfaces:**
- Consumes: the `infra:*` scripts and loopback ports from Task 2.
- Produces: Chinese and English setup instructions for the single supported host-development workflow.

- [ ] **Step 1: Remove container-application comments from `.env.example`**

Use host-development comments only:

```dotenv
# Docker Compose 仅提供本地开发基础设施，MySQL 映射到 127.0.0.1:13306。
DATABASE_URL="mysql://root:waoowaoo123@localhost:13306/waoowaoo"
```

```dotenv
# Docker Compose 仅提供本地开发基础设施，MinIO API 映射到 127.0.0.1:19000。
MINIO_ENDPOINT=http://localhost:19000
```

```dotenv
# 宿主机开发服务地址。
NEXTAUTH_URL=http://localhost:3000
```

```dotenv
# 服务端在宿主机上自调用本应用 API / 文件。
INTERNAL_APP_URL=http://127.0.0.1:3000
```

```dotenv
# Docker Compose 仅提供本地开发基础设施，Redis 映射到 127.0.0.1:16379。
REDIS_HOST=127.0.0.1
REDIS_PORT=16379
```

Keep every environment variable and value unchanged.

- [ ] **Step 2: Replace README startup sections with the host-development workflow**

Both README files must document these exact commands in the appropriate language:

```bash
git clone https://github.com/lihumzsan/waoowaoo.git
cd waoowaoo
cp .env.example .env
npm install
npm run infra:up
npx prisma db push
npm run dev
```

Document application access at `http://localhost:3000`, Bull Board at `http://localhost:3010/admin/queues`, MinIO console at `http://localhost:19001`, and safe shutdown with:

```bash
npm run infra:down
```

State that existing remote MySQL, Redis, and MinIO users may skip `infra:up` and configure `.env`. Remove prebuilt-image, application-image build, GHCR, `13000`/`13010`, Caddy, destructive volume reset, and Docker-container migration instructions.

- [ ] **Step 3: Verify stale deployment guidance is gone**

Run:

```bash
rg -n 'ghcr\.io|docker compose up -d --build|docker rmi|13000|13010|caddy run|localhost:1443|纯 Docker|Pre-built Image|Docker Build' README.md README_en.md .env.example
```

Expected: no matches.

- [ ] **Step 4: Commit developer documentation**

```bash
git add README.md README_en.md .env.example
git commit -m "docs: focus setup on host development"
```

---

### Task 5: Verify the complete cleanup

**Files:**
- Review: all files changed by Tasks 1-4.

**Interfaces:**
- Consumes: the complete implementation diff.
- Produces: test, build, runtime, and diff evidence for handoff.

- [ ] **Step 1: Check repository consistency**

Run:

```bash
git diff HEAD~3 --check
rg -n 'waoowaoo-local|NEXTAUTH_URL.*13000|13010:3010|caddy run|ghcr\.io/saturndec/waoowaoo' --glob '!docs/superpowers/**' --glob '!.git/**' .
```

Expected: no whitespace errors and no live deployment-path matches.

- [ ] **Step 2: Start and verify development infrastructure**

Run:

```bash
npm run infra:up
docker compose ps
npx prisma db push
```

Expected: MySQL, Redis, and MinIO are healthy and Prisma reports the development database schema is synchronized.

- [ ] **Step 3: Run static and test verification**

Run:

```bash
npm run lint:all
npm run typecheck
npm run test:all
npm run build
```

Expected: all commands exit 0. Existing lint warnings are reported separately if they remain non-failing.

- [ ] **Step 4: Stop infrastructure without deleting data**

Run:

```bash
npm run infra:down
docker volume ls --format '{{.Name}}' | rg 'mysql_data|redis_data|minio_data'
```

Expected: the Compose containers stop and the named data volumes still exist.

- [ ] **Step 5: Review final history and status**

Run:

```bash
git log -5 --oneline --decorate
git status --short --branch
```

Expected: the design, plan, runtime cleanup, artifact cleanup, and documentation commits are present; the worktree is clean.
