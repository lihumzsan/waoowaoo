# Task 3 report — Scheduler dependency admission facts

Status: implemented and self-reviewed.

Commit: `feat(temporal): freeze scheduler dependency admission facts` (the final hash is reported in the Task 3 handoff).

Changed files:

- `src/lib/task/dependencies/references.ts`
- `src/lib/temporal/task/contracts.ts`
- `src/lib/temporal/task-client.ts`
- `src/lib/temporal/activities/task.ts` (Task 3 admission hunks only)
- `tests/integration/task/task-dependency-topology.integration.test.ts`

Validation:

- Before implementation: `$env:DATABASE_URL='mysql://root:root@127.0.0.1:32768/waoowaoo_test'; npx.cmd vitest run tests/integration/task/task-dependency-topology.integration.test.ts` — passed (3 tests); the required red test was then added and failed during module resolution because `references.ts` did not exist.
- After implementation: the same focused MySQL command — passed (3 tests).
- Required `npm.cmd run test:conformance` could not launch its child Vitest on this Windows environment because the runner invokes extensionless `npx` and received `spawnSync npx ENOENT` before the suite started. The equivalent command using `npx.cmd vitest run tests/contracts --reporter=default --reporter=json --outputFile=reports/test-results/conformance.json` ran: 42 passed, 1 failed. The failure was pre-existing and outside Task 3: `tests/contracts/task-definition-conformance.test.ts` expects all task definitions to have `executionDeadlineMs === null`, while a dirty Task 1 definition supplies `2592000000`.
- `git diff --check` — passed during self-review.

Concerns:

- Scheduler Workflow adoption of the new required request/admission fields is intentionally deferred to Task 4/Task 5. This task did not modify Scheduler Workflow or operation/terminal call sites.
- The shared worktree contains unrelated dirty Task 1 changes, including terminal-release code; only the Task 3 admission hunks from `src/lib/temporal/activities/task.ts` are staged in this commit.
