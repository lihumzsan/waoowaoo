# Remote-Infrastructure Development Cleanup Design

**Date:** 2026-07-18
**Status:** Corrected after live infrastructure discovery

## Context

This repository is used only for host-based development. Next.js, workers, watchdog, Bull Board, and development warmup run on the development machine through `npm run dev`.

The earlier cleanup incorrectly retained a local MySQL, Redis, and MinIO Compose stack. Live read-only verification established that the active infrastructure is permanently hosted on `192.168.0.112`:

- MySQL: `192.168.0.112:13306`
- Redis: `192.168.0.112:16379`
- MinIO API: `http://192.168.0.112:19000`
- MinIO Console: `http://192.168.0.112:19001`
- ComfyUI: `http://192.168.0.112:8878`

The development machine does not run Docker. The repository must not suggest, configure, or test a local Docker infrastructure path.

## Goals

1. Remove every remaining local Docker entry point from the development repository.
2. Make `192.168.0.112` the single documented infrastructure host.
3. Keep all application and hot-reload processes on the development machine.
4. Prevent a future change from silently restoring local Docker scripts or Compose files.
5. Preserve the existing remote MySQL, Redis, MinIO, and ComfyUI services and data.

## Non-Goals

- Do not connect to a Docker Remote API or manage containers on `192.168.0.112`.
- Do not start, stop, recreate, migrate, or inspect remote Docker volumes.
- Do not run Prisma schema mutation commands against the active remote database.
- Do not modify the ignored local `.env` or print credentials.
- Do not change application behavior, provider logic, queues, database schema, or ComfyUI workflows.
- Do not add a fallback local infrastructure mode.
- Do not remove unrelated npm dependencies, tests, historical specifications, or business assets.

## Chosen Approach

Use a strict remote-only development topology.

Alternative approaches were rejected:

1. Keeping a Compose file for local fallback contradicts the user's explicit statement that local Docker is never used.
2. Keeping a Compose file to manage `192.168.0.112` couples the source checkout to remote infrastructure administration and risks accidental container or volume changes.
3. A disabled or example Compose file still advertises an unsupported path and would require ongoing maintenance.

Therefore, the repository will contain no Docker Compose file or Docker-related npm command.

## Runtime Topology

```text
Development machine
  npm run dev
    Next.js       localhost:3000
    Worker
    Watchdog
    Bull Board    localhost:3010
    Warmup        one shot

192.168.0.112
  MySQL           :13306
  Redis           :16379
  MinIO API       :19000
  MinIO Console   :19001
  ComfyUI          :8878
```

The browser talks only to the development machine. Host application processes talk to the five remote endpoints.

## Repository Changes

### Remove local Docker

Delete `docker-compose.yml`.

The prior cleanup already removed:

- `Dockerfile`
- `.dockerignore`
- `docker-compose.test.yml`
- `.github/workflows/docker-publish.yml`
- `caddyfile`

These files remain absent.

### Remove infrastructure npm commands

Delete from `package.json`:

- `infra:up`
- `infra:down`
- `infra:logs`
- `infra:status`

Keep `npm run dev`, every `dev:*` process, `storage:init`, build, lint, typecheck, and test commands.

### Point the environment template to the remote host

Update only infrastructure endpoints and comments in `.env.example`:

- `DATABASE_URL` uses host `192.168.0.112` and port `13306`.
- `REDIS_HOST=192.168.0.112`.
- `REDIS_PORT=16379`.
- `MINIO_ENDPOINT=http://192.168.0.112:19000`.

Keep credential fields and all unrelated values unchanged. ComfyUI remains configured through the application's provider settings with base URL `http://192.168.0.112:8878`.

The repository will not create `.env`; developers copy the template and retain real local-only secrets outside Git.

### Rewrite development documentation

Both README files will document this single startup path:

1. Copy `.env.example` to `.env`.
2. Install npm dependencies.
3. Confirm the five remote service ports are reachable.
4. Run `npm run dev`.
5. Open the local application and Bull Board.

Remove Docker Desktop prerequisites, `infra:*` commands, local infrastructure ports, volume warnings, and local/remote alternatives.

Document the remote MinIO Console and ComfyUI addresses for diagnostics only.

### Correct the repository contract

Update `tests/unit/config/dev-only-repository.test.ts` so it asserts:

- All Docker and Compose files are absent, including `docker-compose.yml`.
- All `infra:*` and production `start:*` scripts are absent.
- `.env.example` contains the four remote infrastructure endpoint values.
- The template contains no local MySQL, Redis, or MinIO endpoint.

The test reads repository files only and never connects to the remote services.

## Data Safety

- Remote protocol checks are read-only: MySQL metadata query, Redis `PING`/`DBSIZE`, MinIO health/head/list with a maximum of one object, and ComfyUI system/queue metadata.
- No `docker compose`, Docker Remote API, Prisma `db push`, queue mutation, or object write is part of the implementation.
- The existing `192.168.0.112` services remain running and unchanged.
- Local Docker Desktop remains unnecessary and stopped.

## Verification

1. Run the corrected repository contract test red against the current local Docker remnants.
2. Delete Compose and local infrastructure commands, then run the contract test green.
3. Search live repository files for Docker and local infrastructure guidance, excluding historical Superpowers records where appropriate.
4. Re-run read-only protocol checks against all five remote endpoints.
5. Run lint and typecheck.
6. Run the same full test command used before the correction and compare failures to the recorded baseline.
7. Run the Next.js build with temporary environment values sourced from the corrected template.
8. Review the final diff and Git status.

The known pre-existing test failures are not part of this correction:

- the panel image handler test omits `MINIO_ENDPOINT`;
- the ComfyUI video capability test expects an obsolete Goon duration list.

No new failure may be introduced.

## Rollback

The correction is delivered as normal Git commits. Reverting the correction restores only the local Compose file, npm commands, and prior documentation; it does not affect any remote service or data.
