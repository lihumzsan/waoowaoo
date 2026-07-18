# Dev-Only Repository Cleanup Design

**Date:** 2026-07-18

## Context

This repository will be used only for development. The Next.js application, workers, watchdog, Bull Board, and development warmup run on the host through `npm run dev`. Docker remains useful only for the local MySQL, Redis, and MinIO dependencies.

The current repository still carries a complete application-container deployment path:

- `Dockerfile` builds a production image and starts the complete application stack.
- `docker-compose.yml` contains both development infrastructure and a production-style `app` service.
- `.github/workflows/docker-publish.yml` builds and publishes multi-architecture images from `main` and version tags.
- `caddyfile`, production `start:*` scripts, `.env.example`, and both README files document or support the containerized application path.
- `docker-compose.test.yml` is not wired into any package script or test bootstrap. Its ports also differ from the defaults used by `tests/setup/env.ts`.
- `.codex-artifacts` contains 31 tracked verification artifacts totaling about 12.3 MB. They are generated evidence rather than application inputs.

The cleanup must remove deployment-only surface area without deleting development data, changing application behavior, or making the local development loop harder to run.

## Goals

1. Make the repository explicitly development-only.
2. Keep Docker only as an optional local infrastructure provider for MySQL, Redis, and MinIO.
3. Remove application image building, image publishing, production start commands, and their documentation.
4. Remove confirmed generated or disconnected repository artifacts.
5. Preserve the existing host-based `npm run dev` process topology and test behavior.
6. Reduce accidental LAN exposure from development infrastructure.

## Non-Goals

- Do not change business features, API contracts, authentication, queues, storage behavior, or database schema.
- Do not delete or reset Docker volumes or any current MySQL, Redis, or MinIO data.
- Do not change the current `.env` file or expose its values.
- Do not remove ComfyUI workflows, prompts, tests, historical Superpowers specifications, or plans.
- Do not perform speculative dependency or dead-code deletion based only on filename or static-import heuristics.
- Do not add a new deployment mechanism or replacement image-publishing workflow.
- Do not fold unrelated security findings or functional fixes into this cleanup.

## Chosen Approach

Use a development-first consolidation:

- The application and background processes run directly on the host.
- One Compose file provides only MySQL, Redis, and MinIO.
- Development and integration tests reuse those infrastructure services. Test setup continues deriving a separate `_test` database from `DATABASE_URL`.
- Repository documentation and scripts expose only the supported development workflow.

This approach is preferred over a minimal deletion because it removes misleading deployment paths and tracked generated output in the same bounded change. It is preferred over an aggressive repository purge because historical design records and manually useful tools cannot be proven unused from runtime references alone.

## File-Level Changes

### Remove deployment-only files

Delete:

- `Dockerfile`
- `.dockerignore`
- `.github/workflows/docker-publish.yml`
- `caddyfile`

The Caddy configuration is part of the old containerized application path because it proxies the Docker-only application ports `13000` and `13010`. It will not be rewritten for host development in this change.

### Consolidate development infrastructure

Rewrite `docker-compose.yml` to contain only:

- MySQL 8 on host port `13306`
- Redis 7 on host port `16379`
- MinIO on host ports `19000` and `19001`
- Existing named data volumes
- Existing health checks

All published ports must bind to `127.0.0.1`, not every host interface. Remove the `app` service, application build configuration, application secrets, application ports, application log mounts, fixed `container_name` values, and automatic restart policies.

The existing local-only development credentials may remain because they match `.env.example` and are no longer exposed to the LAN. They must be clearly documented as development defaults.

### Remove the disconnected test Compose file

Delete `docker-compose.test.yml`.

The repository does not invoke this file. Current test bootstrap uses the development infrastructure ports and derives a separate test database name. Removing the unused file therefore aligns the documented topology with actual test behavior rather than changing the test runtime.

### Simplify package scripts

Remove these production-only scripts from `package.json`:

- `start`
- `start:next`
- `start:worker`
- `start:watchdog`
- `start:board`

Keep:

- `npm run dev` and all `dev:*` processes
- `storage:init`
- `build`, lint, typecheck, test, and verification commands
- Operational development utilities such as log and audit commands

Add small infrastructure helpers:

- `infra:up` starts the Compose services in the background.
- `infra:down` stops the Compose services without deleting volumes.
- `infra:logs` follows infrastructure logs.
- `infra:status` shows current service state.

Do not make `npm run dev` automatically start or stop Docker. Keeping the boundary explicit allows the same host application commands to work with either this local Compose stack or existing remote infrastructure configured in `.env`.

Update the warmup wiring test so it verifies the development command directly and no longer assumes a production `start` script exists.

### Remove generated verification artifacts

Delete the tracked `.codex-artifacts` directory and add `.codex-artifacts/` to `.gitignore`.

These files are screenshots, rendered videos, extracted frames, prompts, and metadata produced during earlier verification. No runtime, test, README, or build path references them. Future local verification can recreate the directory without polluting Git history.

Remove obsolete Docker application log ignore entries only when their producer has also been removed. Preserve unrelated runtime and IDE ignore rules.

### Rewrite developer documentation

Update `README.md` and `README_en.md` so the supported startup path is:

1. Copy `.env.example` to `.env` and configure required local values.
2. Install dependencies.
3. Run `npm run infra:up` when using local Docker infrastructure.
4. Run `npx prisma db push` for initial schema setup.
5. Run `npm run dev`.
6. Use `npm run infra:down` to stop infrastructure without deleting data.

Remove instructions for prebuilt images, application image builds, GHCR updates, Docker application ports, Caddy, and application-container data migration.

Update `.env.example` comments to describe host development only. Keep the current variable names and development port values so existing code behavior does not change.

## Runtime Topology After Cleanup

```text
Host processes
  npm run dev
    Next.js       :3000
    Worker
    Watchdog
    Bull Board    :3010
    Warmup (one shot)

Local Docker infrastructure (optional)
  MySQL           127.0.0.1:13306
  Redis           127.0.0.1:16379
  MinIO API       127.0.0.1:19000
  MinIO Console   127.0.0.1:19001
```

If `.env` points to remote infrastructure, the host processes continue to work and `npm run infra:up` is simply not used.

## Data Safety

- Do not run `docker compose down -v`.
- Do not delete or rename the existing named volumes in this cleanup.
- Rewriting the Compose services must preserve the volume keys `mysql_data`, `redis_data`, and `minio_data` so existing local data remains attachable.
- `infra:down` must use `docker compose down` without `--volumes`.
- No database migration or destructive Prisma command is part of this work.
- Removing tracked `.codex-artifacts` affects only generated repository files; it does not affect application storage or Docker volumes.

## Dependency-Cleanup Boundary

Removing the production `start:*` scripts does not make `concurrently` or `tsx` unused because the development process still requires them. Bull Board, Express, Prisma, Redis, MySQL, and MinIO-related packages also remain part of the development runtime.

Package dependencies will be removed only if repository-wide search plus lint, typecheck, tests, and build prove they are disconnected. No dependency removal is expected solely from eliminating Docker deployment.

## Verification

The implementation is complete only after all of the following:

1. `git diff --check`
2. Repository-wide search finds no live references to the deleted Docker application path, GHCR workflow, ports `13000`/`13010`, or Caddy command.
3. `docker compose config` validates the infrastructure-only Compose file.
4. Published Compose ports resolve to `127.0.0.1`.
5. `npm run infra:up` starts healthy MySQL, Redis, and MinIO services.
6. `npx prisma db push` succeeds against the development database.
7. `npm run lint:all`
8. `npm run typecheck`
9. `npm run test:all`
10. `npm run build`
11. `npm run infra:down` stops containers without deleting volumes.
12. A final Git status and diff review confirms that only the approved cleanup scope changed.

If a full test fails because of a pre-existing application defect, capture the exact failure and distinguish it from cleanup regressions. Cleanup-specific tests and configuration checks must still pass before handoff.

## Rollback

The cleanup will be delivered as normal Git commits. Reverting those commits restores the removed deployment files and tracked artifacts. Docker data remains outside Git and is protected by retaining the named volumes and avoiding destructive Compose commands.
