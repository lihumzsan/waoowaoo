# Task 8 report — architecture closure and final verification

## Authority change

Task dependency readiness now has one durable authority: the per-user Temporal User Task Scheduler. The frozen Operation plan owns `required_success` edges, MySQL persists only their immutable topology, and the Task terminal service commits only the named Task terminal bundle. The architecture modules now record this as TL-25 and DE-23.

No `modules.json` change was required; the existing path mappings cover the changed production modules.

## Reference-implementation touchpoint alignment

| Reference touchpoint | New coverage / not-applicable reason | Evidence |
| --- | --- | --- |
| Identity | Internal edges use frozen Plan task identities; persisted references project canonical Task IDs and sorted dependency IDs. | `tests/unit/operations/task-edge-policy.test.ts`; `tests/unit/temporal/task-dependency-gate.test.ts` |
| Persistence | Approved-plan transaction creates queued Tasks and writes immutable `TaskDependency` topology. | Task 2 report; `src/lib/task/dependencies/persistence.ts` |
| Execution | User Task Scheduler is the only dependency admission/wait/start/cancel arbiter; Task Workflow remains the attempt executor. | `tests/unit/temporal/task-dependency-gate.test.ts`; Task 7 report |
| Lifecycle | Waiting is scheduler state, not a MySQL Task status; terminal service only handles the caller's Task bundle. | lifecycle searches below; architecture TL-25 |
| Failure | Required-source failure/cancel uses the existing queued-cancel terminal route and returns FollowUpBatch readiness exactly once. | Scheduler gate tests; Task 7 report (live suite blocked) |
| Recovery | Scheduler retains dependency terminal facts across Continue-As-New; terminal ACK-loss recovery remains activity/receipt based. | architecture DE-23; Task 7 report |
| Projection | `buildPersistedTaskReference*` is the canonical DB projector; no call-site dependency inference remains. | `src/lib/task/dependencies/references.ts`; typecheck/lint pass |
| Permission | Existing operation/project/user authorization and task terminal ownership remain authoritative; dependency gating adds no permission bypass. | architecture impact mapping; typecheck pass |
| i18n | No new user-visible copy was added in Task 8; existing operation/UI localization remains unchanged. | `git diff --check`; typecheck pass |
| MOSS graph/upload/output | Fixed local MOSS loader/codec paths, isolated reference upload, MP3 output contract, and output-node validation were completed in Task 6. | `tests/contracts/comfyui-moss-tts.contract.test.ts` (PASS in Task 6) |
| FFmpeg mix | Narration and optional BGM are mixed through the existing video composition boundary; voiceover timeline validation has focused unit evidence. | `tests/unit/video-compose/voiceover-timeline.test.ts` (PASS in Task 6) |
| Verification | Static checks and focused contracts pass; required suites and live MySQL/Temporal/ComfyUI evidence remain environment-blocked or unverified. | command results below |

## Verification evidence

- `npm.cmd run architecture:impact -- src/lib/operations/planning.ts src/lib/task/dependencies src/lib/temporal/workflows/user-task-scheduler.ts src/lib/task/terminal/service.ts` — PASS; mapped to existing `free-product`, `async-task-lifecycle`, and `durable-execution` modules.
- Historical evidence: `git show --stat --oneline 653acadc...`, `31fd7fb1...`, and `dd091446...` — PASS; prior Temporal boundary, scheduler recovery, and workflow versioning decisions reviewed.
- `npx.cmd prisma validate` — BLOCKED before schema validation: `DATABASE_URL` is not set (Prisma P1012). Migration was not executed.
- `npm.cmd run architecture:durable-budget` — BLOCKED by pre-existing classification gap (`src/lib/agent-turn/effect-fence.ts` unclassified and 17 agent-turn files missing).
- `npm.cmd run typecheck` — PASS (TypeScript, runtime scripts, and free-product contract check).
- Focused contracts/gates: `npx.cmd vitest run tests/unit/temporal/task-dependency-gate.test.ts tests/contracts/free-operation-plan.contract.test.ts tests/unit/operations/task-edge-policy.test.ts` — PASS, 3 files / 12 tests.
- Focused lint: requested Task/Temporal/voiceover paths — PASS.
- `npm.cmd run test:logic`, `npm.cmd run test:conformance`, `npm.cmd run test:critical:task`, `npm.cmd run test:critical:temporal` — BLOCKED by the Windows required-suite runner invoking bare `npx` (`spawnSync npx ENOENT`); JSON reports were not produced. The conformance report also contains the same runner failure.
- Live host app, MySQL/Temporal worker, and ComfyUI `/object_info`/`/prompt`/`/view` path — UNVERIFIED. No authorized 3–10 second reference Resource and no verified live ComfyUI runtime were available in this turn; no substitute media was used.

## Lifecycle closure checks

Searches across `src/lib/task`, `src/lib/operations`, and `src/lib/temporal` found no `TASK_STATUS.BLOCKED`, literal `'blocked'`, `initialStatus`, `settleTaskDependenciesInTransaction`, or terminal-side dependency release helper. `schedulePersistedTask` remains only in operation submission/scheduler enqueue paths; it is not called by the terminal service. Topology rows expose no lifecycle status/settlement/release fields.

Authority summary: per-user User Task Scheduler dependency gate; unique Task terminal writer remains the Task terminal service. Dependency lifecycle writers are `2 -> 0`; dependency readiness arbiters are `2 -> 1`; Task terminal writers remain `1`. Static searches found no residual dual-track hits, but the runtime boundary remains unverified: `npm.cmd run test:logic`, `test:conformance`, `test:critical:task`, and `test:critical:temporal` were blocked by the Windows runner's `spawnSync npx ENOENT`; Prisma validation was blocked by missing `DATABASE_URL`; and live MySQL/Temporal/ComfyUI execution was not available. Therefore no claim is made that runtime dual tracks are fully excluded.
