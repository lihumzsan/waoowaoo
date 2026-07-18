# Remote-Infrastructure Development Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove local Docker completely and make `192.168.0.112` the repository's only documented MySQL, Redis, MinIO, and ComfyUI host.

**Architecture:** The development machine runs Next.js, workers, watchdog, Bull Board, and warmup through `npm run dev`. It does not run or manage Docker; all infrastructure and GPU calls go to the already-running services on `192.168.0.112`.

**Tech Stack:** Node.js, npm scripts, Next.js 15, Vitest, MySQL 8, Redis 7, MinIO, ComfyUI.

## Global Constraints

- Do not start, stop, recreate, migrate, or inspect remote Docker volumes.
- Do not connect to a Docker Remote API.
- Do not run Prisma schema mutation commands against `192.168.0.112`.
- Do not modify the ignored local `.env` or print credentials.
- Do not add a local fallback infrastructure path.
- Keep `npm run dev`, all `dev:*` processes, `storage:init`, build, lint, typecheck, and test commands.
- Keep application behavior, provider logic, queues, database schema, and ComfyUI workflows unchanged.
- Use read-only remote protocol checks only.

---

### Task 1: Replace the local-infrastructure contract with a remote-only contract

**Files:**
- Modify: `tests/unit/config/dev-only-repository.test.ts`

**Interfaces:**
- Consumes: root deployment paths, `package.json`, and `.env.example`.
- Produces: a file-based regression contract that prohibits local Docker and requires the remote endpoints.

- [ ] **Step 1: Write the remote-only contract before implementation**

Replace `tests/unit/config/dev-only-repository.test.ts` with:

```ts
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

const root = process.cwd()

function readRootFile(path: string) {
  return readFileSync(join(root, path), 'utf8')
}

describe('remote-only development repository contract', () => {
  test('local Docker entry points are absent', () => {
    for (const path of [
      'Dockerfile',
      '.dockerignore',
      'docker-compose.yml',
      'docker-compose.test.yml',
      '.github/workflows/docker-publish.yml',
      'caddyfile',
    ]) {
      expect(existsSync(join(root, path)), path).toBe(false)
    }
  })

  test('npm scripts contain no infrastructure or production start commands', () => {
    const packageJson = JSON.parse(readRootFile('package.json')) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts.dev).toContain('npm run dev:warmup')
    expect(packageJson.scripts['infra:up']).toBeUndefined()
    expect(packageJson.scripts['infra:down']).toBeUndefined()
    expect(packageJson.scripts['infra:logs']).toBeUndefined()
    expect(packageJson.scripts['infra:status']).toBeUndefined()
    expect(packageJson.scripts.start).toBeUndefined()
    expect(packageJson.scripts['start:next']).toBeUndefined()
    expect(packageJson.scripts['start:worker']).toBeUndefined()
    expect(packageJson.scripts['start:watchdog']).toBeUndefined()
    expect(packageJson.scripts['start:board']).toBeUndefined()
  })

  test('environment template targets the remote infrastructure host', () => {
    const envTemplate = readRootFile('.env.example')

    expect(envTemplate).toContain(
      'DATABASE_URL="mysql://root:waoowaoo123@192.168.0.112:13306/waoowaoo"',
    )
    expect(envTemplate).toContain('REDIS_HOST=192.168.0.112')
    expect(envTemplate).toContain('REDIS_PORT=16379')
    expect(envTemplate).toContain('MINIO_ENDPOINT=http://192.168.0.112:19000')
    expect(envTemplate).not.toMatch(
      /(?:localhost|127\.0\.0\.1):(13306|16379|19000|19001)/,
    )
    expect(envTemplate).not.toMatch(
      /^REDIS_HOST=(?:localhost|127\.0\.0\.1)$/m,
    )
  })
})
```

- [ ] **Step 2: Run the contract and verify RED**

Run:

```bash
npx vitest run tests/unit/config/dev-only-repository.test.ts
```

Expected: FAIL because `docker-compose.yml`, the four `infra:*` scripts, and local endpoint values still exist.

---

### Task 2: Remove local Docker and point configuration to the remote host

**Files:**
- Delete: `docker-compose.yml`
- Modify: `package.json`
- Modify: `.env.example`
- Test: `tests/unit/config/dev-only-repository.test.ts`
- Test: `tests/unit/scripts/dev-warmup-wiring.test.ts`

**Interfaces:**
- Consumes: the RED contract from Task 1 and verified remote endpoints.
- Produces: a repository with no Docker command and a remote-ready environment template.

- [ ] **Step 1: Delete the remaining Compose file**

Delete `docker-compose.yml` with the patch tool. Do not run any Docker command locally or remotely.

- [ ] **Step 2: Remove local infrastructure scripts**

Delete exactly these lines from `package.json`:

```json
    "infra:up": "docker compose up -d --wait",
    "infra:down": "docker compose down",
    "infra:logs": "docker compose logs -f",
    "infra:status": "docker compose ps",
```

Do not change dependencies or any other script.

- [ ] **Step 3: Change only infrastructure endpoints and comments**

Use these exact lines in `.env.example`:

```dotenv
# 远端开发数据库固定运行在 192.168.0.112:13306。
DATABASE_URL="mysql://root:waoowaoo123@192.168.0.112:13306/waoowaoo"
```

```dotenv
# 远端 MinIO API 固定运行在 192.168.0.112:19000。
MINIO_ENDPOINT=http://192.168.0.112:19000
```

```dotenv
# 远端 Redis 固定运行在 192.168.0.112:16379。
REDIS_HOST=192.168.0.112
REDIS_PORT=16379
```

Add this comment to the ComfyUI section without inventing a new environment variable:

```dotenv
# ComfyUI 服务地址在应用设置中心配置为 http://192.168.0.112:8878。
```

Keep all credential fields and unrelated values unchanged.

- [ ] **Step 4: Run targeted tests and verify GREEN**

Run:

```bash
npx vitest run tests/unit/config/dev-only-repository.test.ts tests/unit/scripts/dev-warmup-wiring.test.ts
```

Expected: both files PASS.

---

### Task 3: Rewrite the bilingual remote-only development instructions

**Files:**
- Modify: `README.md`
- Modify: `README_en.md`

**Interfaces:**
- Consumes: the remote endpoint template from Task 2.
- Produces: one supported startup flow with no Docker or schema mutation instructions.

- [ ] **Step 1: Document the exact startup sequence**

Both README files must contain:

```bash
git clone https://github.com/lihumzsan/waoowaoo.git
cd waoowaoo
cp .env.example .env
npm install
npm run dev
```

The prerequisites are Node.js >= 18.18.0, npm >= 9.0.0, and network access to `192.168.0.112`. Docker Desktop is not a prerequisite.

- [ ] **Step 2: Document the runtime boundary**

Document:

- local application: `http://localhost:3000`;
- local Bull Board: `http://localhost:3010/admin/queues`;
- remote MySQL: `192.168.0.112:13306`;
- remote Redis: `192.168.0.112:16379`;
- remote MinIO API: `http://192.168.0.112:19000`;
- remote MinIO Console: `http://192.168.0.112:19001`;
- remote ComfyUI: `http://192.168.0.112:8878`.

Remove every `infra:*` command, Docker Desktop instruction, local infrastructure alternative, volume command, and `npx prisma db push` instruction.

- [ ] **Step 3: Verify stale local-infrastructure guidance is absent**

Run:

```bash
if rg -n 'Docker Desktop|docker compose|infra:(up|down|logs|status)|localhost:(13306|16379|19000|19001)|127\.0\.0\.1:(13306|16379|19000|19001)|prisma db push' README.md README_en.md .env.example package.json; then exit 1; fi
```

Expected: no matches.

- [ ] **Step 4: Commit the remote-only implementation**

```bash
git add -A -- docker-compose.yml package.json .env.example README.md README_en.md tests/unit/config/dev-only-repository.test.ts tests/unit/scripts/dev-warmup-wiring.test.ts
git commit -m "refactor: use remote development infrastructure only"
```

---

### Task 4: Verify remote connectivity and repository quality

**Files:**
- Review: all files changed in Tasks 1-3.

**Interfaces:**
- Consumes: the complete remote-only implementation.
- Produces: read-only service evidence plus static, test, build, and Git evidence.

- [ ] **Step 1: Verify remote ports and protocols without mutation**

Check TCP ports `13306`, `16379`, `19000`, `19001`, and `8878`.

Use repository dependencies with values sourced from `.env.example` to perform:

- MySQL `SELECT DATABASE()` and an information-schema table count;
- Redis `PING` and `DBSIZE`;
- MinIO `HeadBucket` and `ListObjectsV2` with `MaxKeys: 1`;
- ComfyUI `/system_stats`, `/queue`, and `/object_info` metadata reads.

Expected: every endpoint succeeds without writing remote state.

- [ ] **Step 2: Run targeted and static verification**

Run:

```bash
git diff --check
npx vitest run tests/unit/config/dev-only-repository.test.ts tests/unit/scripts/dev-warmup-wiring.test.ts
npm run lint:all
npm run typecheck
```

Expected: targeted tests, lint, and typecheck exit 0. Existing lint warnings may remain non-failing.

- [ ] **Step 3: Run the full test suite and compare baseline failures**

Run:

```bash
npm run test:all
```

Expected: the remote-only correction adds no failure. The recorded baseline contains two unrelated failures: missing `MINIO_ENDPOINT` in the panel image handler test and an obsolete Goon duration list assertion.

- [ ] **Step 4: Build with the corrected template without creating `.env`**

Run:

```bash
set -a
source ./.env.example
set +a
npm run build
```

Expected: build exits 0.

- [ ] **Step 5: Review final Git state**

Run:

```bash
git diff origin/main..HEAD --check
git status --short --branch
git log -8 --oneline --decorate
```

Expected: the correction commits are present and the worktree is clean.

## Delivery Record

### Actual Implementation

- Revalidated the remote-only development boundary after a clean restart: MySQL, Redis, and MinIO remain configured on `192.168.0.112`; `npm run dev` starts Next.js, worker, watchdog, and Bull Board successfully.
- Removed six tracked public assets with zero repository references: the four default Next.js SVGs, the unused legacy `public/icon.png`, and the unused `grid-template-9x16.png`.
- Removed the landing-page local-image query string, added above-the-fold priority, and added a regression test for both conditions.
- Corrected both READMEs to describe route warmup as opt-in through `npm run dev:full`.
- Eliminated all twelve existing ESLint unused-variable warnings without changing runtime contracts.
- Removed completed local `.superpowers` review intermediates and the current Playwright CLI session artifacts; `.env`, IDE state, logs, dependencies, and active runtime configuration were preserved.

### Plan Deviations

- A later approved performance change made warmup opt-in instead of part of default `npm run dev`; the READMEs now reflect the current package scripts rather than this plan's original startup wording.
- The restart audit included narrow repository hygiene and a Next.js image-warning fix beyond the original Docker-removal file list. These changes preserve the remote-infrastructure boundary and application behavior.

### Impact

- No database schema, queue, provider, storage, ComfyUI workflow, credential, or ignored `.env` value changed.
- The deleted public files have no source, configuration, test, or documentation references. Existing metadata continues to use `/logo.ico` and `/logo.png`.
- The landing page no longer emits local-image pattern or LCP priority warnings after a browser reload.

### Verification

- `npm run test:unit:all`: 301 files and 1,315 tests passed.
- `npm run lint`: exit 0 with zero warnings.
- `npm run typecheck`: exit 0.
- `npm run build`: exit 0; 72 static pages generated.
- Authenticated-independent browser reload of `/zh`: zero console errors and zero warnings after the fix.
- Runtime smoke: `/zh` and Bull Board returned HTTP 200; Next.js, worker, watchdog, and Bull Board remained active during observation.
- Independent read-only review found no Critical, Important, or Minor issues and approved all six resource deletions.
- `git diff --check`: exit 0.

### Remaining Risks

- `npm audit --omit=dev` reports 22 dependency advisories (14 high, 8 moderate), including Next.js and Undici. The dry run would change 50 packages and remove 365 installed development packages under `--omit=dev`, so a broad automatic fix was intentionally not applied in this cleanup.
- Repository search cannot prove that an external system has never bookmarked one of the deleted public URLs; no repository evidence indicates such a contract.

### Follow-ups

- Handle dependency security upgrades as an isolated, fully tested change instead of mixing them into repository cleanup.

### ZenTao Closeout

- Not requested and not performed.
