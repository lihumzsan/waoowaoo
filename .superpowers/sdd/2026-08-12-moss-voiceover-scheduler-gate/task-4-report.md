# Task 4 report

## Status

Implementation complete for the Scheduler required-success dependency gate. The shared application remains an intentional protocol-cutover intermediate until Task 5 migrates the old callers and terminal path.

## Commit

- `feat(temporal): gate required-success tasks in scheduler`

## Changed files

- `src/lib/temporal/task/dependency-gate.ts`
- `src/lib/temporal/task/contracts.ts`
- `src/lib/temporal/workflows/user-task-scheduler.ts`
- `tests/unit/temporal/task-dependency-gate.test.ts`
- `.superpowers/sdd/2026-08-12-moss-voiceover-scheduler-gate/task-4-report.md`

## Verification

- RED: `npx.cmd vitest run tests/unit/temporal/task-dependency-gate.test.ts` — failed because `@/lib/temporal/task/dependency-gate` did not exist.
- GREEN: `npx.cmd vitest run tests/unit/temporal/task-dependency-gate.test.ts` — exit 0; 1 file passed, 2 tests passed.
- Final: `git diff --check` — exit 0; only existing line-ending conversion warnings were printed.
- Final: `npx.cmd vitest run tests/unit/temporal/task-dependency-gate.test.ts` — exit 0; 1 file passed, 2 tests passed.
- `npm.cmd run architecture:durable-budget` was not run because the parent explicitly narrowed final verification to `git diff --check` and the completed pure test.

## Concerns

- Task 5 must complete the hard cutover for old submit/cancel callers and the terminal-service path before treating the application as runnable or whole-repository type-consistent.
- Per parent instruction, no whole-repository typecheck, app startup, or broader Temporal suite was run in this task.

## Fix round 1

- Admission terminal results now validate Task ID, canonical workflow ID, status agreement, terminal event, attempts, and follow-up receipt shape before indexing.
- Dependency admission facts validate source Task ID/workflow ID and terminal status/event consistency.
- Dependency cancellation metadata is validated in the Activity and forwarded to the terminal event payload as `TASK_DEPENDENCY_FAILED` plus sorted `dependencySourceTaskIds`.
- Dependency cancellation marks the enqueue `notification_pending` before awaiting the terminal Activity and keeps an in-flight receipt for overlapping user cancellation replay.
- Completion retention now deduplicates arbitrary repeated Task IDs; focused pure coverage is 3/3.

Fix verification:

- `npx.cmd vitest run tests/unit/temporal/task-dependency-gate.test.ts` — exit 0; 1 file passed, 3 tests passed.
- `git diff --check` — exit 0; existing CRLF conversion warnings only.
- Whole-repository typecheck remains intentionally blocked by the Task 2–5 protocol cutover and pre-existing dirty callers; no Workflow harness was added in this fix round.
