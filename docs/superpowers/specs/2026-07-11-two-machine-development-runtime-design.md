# Two-Machine Development Runtime Design

## Goal

Keep `192.168.0.116` useful as the high-frequency development workstation while using the stronger, always-on `192.168.0.112` machine for persistent infrastructure and GPU generation.

The design must preserve fast frontend and backend edit cycles, avoid two copies of the source tree, reduce memory pressure on the 16 GB workstation, and make the first trial reversible.

## Confirmed Environment

### Development workstation: `192.168.0.116`

- Intel Core i7-8750H, 6 cores / 12 threads.
- 16 GB RAM.
- NVIDIA GTX 1050 Ti plus Intel integrated graphics.
- Holds the active Git checkout, Codex, VS Code, Chrome, Node.js development processes, and the current Docker-backed MySQL, Redis, and MinIO services.
- A live measurement showed roughly 3 GB Chrome working set, 2.2 GB Node working set, and 3.5 GB private memory committed by WSL.

### Infrastructure and compute machine: `192.168.0.112`

- Intel Core i5-13600KF, 14 cores / 20 threads.
- 64 GB RAM.
- NVIDIA RTX 5070 Ti.
- Can remain powered on and is dedicated to ComfyUI and project background infrastructure.
- ComfyUI is reachable at `192.168.0.112:8878`.
- Docker already contains the project's MySQL, Redis, MinIO, and persisted data. The trial will reuse these services instead of performing a default bulk migration.
- At design time, RDP and ComfyUI were reachable from `192.168.0.116`; the historical MySQL, Redis, and MinIO ports were not reachable and therefore require a listening and firewall check before the trial.

## Selected Architecture

### `192.168.0.116`: development workstation

The workstation remains the only source-code workspace and runs all processes that need immediate feedback from code edits:

- Git checkout and working tree.
- Codex and VS Code.
- Chrome.
- Next.js development server.
- Image, video, voice, and text BullMQ workers.
- Watchdog.
- Bull Board.
- Local Codex CLI provider execution.

This keeps frontend, API, and worker changes in one checkout. No source synchronization, remote deployment, or duplicate `node_modules` tree is needed for normal development.

### `192.168.0.112`: persistent infrastructure and GPU compute

The server runs the stateful and long-lived services:

- ComfyUI on port `8878`.
- MySQL, expected on port `13306` unless the live Docker configuration proves otherwise.
- Redis, expected on port `16379` unless the live Docker configuration proves otherwise.
- MinIO API and console, expected on ports `19000` and `19001` unless the live Docker configuration proves otherwise.
- Docker volumes, backups, generated media storage, models, and ComfyUI custom nodes.

It does not run Next.js, application workers, Codex, or a second application checkout during the normal development workflow.

## Data and Request Flow

1. The user edits code on `192.168.0.116`.
2. Next.js and `tsx watch` observe the same local working tree.
3. Next.js and workers connect over the LAN to MySQL, Redis, and MinIO on `192.168.0.112`.
4. ComfyUI jobs are submitted to `192.168.0.112:8878`.
5. Generated media is persisted through the MinIO service on `192.168.0.112`.
6. Chrome continues to open the application from the local Next.js server so Fast Refresh and error overlays remain immediate.

The project must use a browser-reachable MinIO public endpoint when it produces signed or direct media URLs. Internal service endpoints and public media endpoints must not be assumed to be interchangeable.

## Code Reload and Restart Rules

| Change | Expected behavior |
| --- | --- |
| React components, CSS, client code | Next.js Fast Refresh; no manual restart |
| API routes and ordinary Next.js server TypeScript | Automatic recompilation; no routine restart |
| Worker handler code | `tsx watch` restarts the worker process |
| Watchdog or Bull Board code | Their `tsx watch` process restarts automatically |
| `.env`, startup arguments, or process topology | Restart the local development process tree |
| `package.json` or dependencies | Install dependencies, then restart affected local processes |
| Prisma schema | Apply the approved schema operation, regenerate Prisma Client, then restart affected local processes |
| MySQL, Redis, MinIO, or ComfyUI configuration | Restart only the corresponding service on `192.168.0.112` |

## Existing Docker Data Policy

The first trial will directly use the existing Docker services and volumes on `192.168.0.112`. It will not overwrite them and will not copy the local Docker volumes by default.

Before changing the local `.env`, the trial must verify:

- Docker container names, image versions, health, restart policy, volume mounts, and bound ports.
- The expected application database exists and accepts an authenticated connection.
- Key table counts and the newest relevant timestamps are compatible with the user's claim that the data is complete.
- The MinIO bucket exists, representative image/video/audio objects can be read, and object counts are plausible.
- Redis responds and its keyspace does not contain stale active BullMQ jobs that would be incorrectly resumed.
- ComfyUI `/system_stats` and `/queue` are reachable.

If the remote database or object storage is demonstrably behind the current local state, the trial stops before switching. It must not merge or overwrite data automatically.

Redis queue state is disposable for the trial. Stale queued or processing jobs must not be resumed merely because an old Redis volume exists.

## Network and Security

- Give `192.168.0.112` a stable DHCP reservation or static address.
- Bind MySQL, Redis, MinIO, and ComfyUI to an address reachable from the LAN only as required.
- Windows Firewall on `192.168.0.112` should allow required ports only from `192.168.0.116`.
- MySQL, Redis, and MinIO must retain authentication; credentials remain only in `.env` or the service secret store and never enter Git or terminal logs.
- RDP remains available for administration.
- Public internet exposure, router port forwarding, and unauthenticated LAN-wide Redis access are out of scope and prohibited by this design.

## Trial Procedure

The trial is a controlled connection switch, not a destructive migration:

1. Record the current local service endpoints and a baseline of application behavior and memory usage.
2. Inspect and validate the existing Docker services and data on `192.168.0.112` through RDP.
3. Open only the required server ports to `192.168.0.116` and confirm connectivity.
4. Stop the local application process tree so it cannot write while connection settings change.
5. Save a secure backup of the local `.env` outside Git.
6. Change only the database, Redis, MinIO, and related public endpoint values to point to `192.168.0.112`; keep ComfyUI at `192.168.0.112:8878`.
7. Start the local Next.js, workers, watchdog, and Bull Board processes.
8. Run the acceptance checks below.
9. If all checks pass, stop local Docker infrastructure and disable its automatic startup while retaining it temporarily for rollback.

## Acceptance Checks

- Existing user login succeeds.
- Expected projects, episodes, characters, locations, storyboards, and provider configuration are visible.
- Representative existing image, video, and audio assets open successfully.
- A small text task completes through Redis and the local worker.
- A small ComfyUI task completes through `192.168.0.112:8878` and its result is readable from MinIO.
- A Codex CLI provider smoke test succeeds from `192.168.0.116`.
- Bull Board shows the expected queue state without resurrecting stale work.
- Editing one frontend file triggers Fast Refresh.
- Editing one worker file triggers a watcher restart and the worker reconnects to remote Redis.
- Chrome and total workstation memory are remeasured after local Docker infrastructure is stopped.

## Failure Handling and Rollback

If any acceptance check fails:

1. Stop the local application process tree.
2. Restore the saved local `.env`.
3. Start the retained local Docker services.
4. Restart the local application process tree.
5. Confirm the original local path is healthy before investigating the remote service.

The trial must not delete local Docker volumes, remove remote volumes, or modify remote data destructively. Local infrastructure remains available until at least one complete generation chain and one normal development edit cycle have succeeded against the remote services.

## Separate Browser Optimization

Infrastructure placement does not eliminate the confirmed GPU cost of the workspace's animated background. A separate, low-risk frontend change should reduce or disable the 200% blurred animated background and full-screen backdrop blur. This is independent of the service trial and should be measured separately so its benefit is not confused with moving Docker infrastructure.

## Non-Goals

- Moving Codex, VS Code, Chrome, Next.js, or application workers to `192.168.0.112`.
- Maintaining two writable application source trees.
- Automatically merging divergent MySQL or MinIO data.
- Exposing infrastructure services to the public internet.
- Deleting either machine's existing Docker volumes during the trial.
