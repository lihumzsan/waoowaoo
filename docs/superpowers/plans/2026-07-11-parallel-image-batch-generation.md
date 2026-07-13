# Parallel Image Batch Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split project character and location image batches into independently retryable single-image jobs and enforce a global image concurrency limit of 10.

**Architecture:** Project batch submissions expand into child `image_character` or `image_location` tasks carrying shared batch metadata. BullMQ enforces queue-wide concurrency 10, the existing user gate enforces the user's configured cap, and target-state resolution aggregates the newest batch while legacy non-batch tasks retain existing behavior.

**Tech Stack:** TypeScript, Next.js 15 route services, BullMQ 5.67, Prisma 6, Vitest 2, MySQL, React Query/SSE.

## Global Constraints

- Global image concurrency is exactly 10 across all image worker processes.
- The current user's `imageConcurrency` is 10; future users retain their own configured limit.
- Every image is a separate task and only the failed image retries.
- Successful images persist immediately and an older superseded task cannot overwrite a newer request.
- Existing single-image tasks and already queued legacy group tasks remain compatible.
- Do not modify unrelated dirty worktree files.

## File Map

- `src/lib/task/queues.ts`: parse, apply, and expose BullMQ global image concurrency.
- `src/lib/workers/index.ts`: configure global concurrency before constructing workers.
- `.env`, `.env.example`: set local and documented image concurrency to 10.
- `src/lib/image-generation/batch-task-submitter.ts`: create child task payloads, supersede prior active image tasks, and return a backward-compatible batch response.
- `src/lib/assets/services/asset-actions.ts`: route project multi-image requests through the batch submitter.
- `src/lib/workers/handlers/character-image-task-handler.ts`: safely merge a single child result into a shared character appearance.
- `src/lib/task/state-service.ts`: aggregate the newest batch for a target.
- `src/lib/query/hooks/useTaskTargetStateMap.ts`: expose optional batch state to UI consumers.
- Targeted unit and integration tests: prove concurrency, submission, retry isolation, safe persistence, and aggregation.

---

### Task 1: Enforce global image queue concurrency 10

**Files:**
- Modify: `src/lib/task/queues.ts`
- Modify: `src/lib/workers/index.ts`
- Modify: `.env`
- Modify: `.env.example`
- Create: `tests/unit/task/image-queue-concurrency.test.ts`

**Interfaces:**
- Produces: `readImageQueueGlobalConcurrency(raw?: string): number`
- Produces: `configureImageQueueGlobalConcurrency(): Promise<number>`
- Consumes: BullMQ `Queue.setGlobalConcurrency(concurrency)`

- [ ] **Step 1: Write the failing parser tests**

```ts
import { describe, expect, it } from 'vitest'
import { readImageQueueGlobalConcurrency } from '@/lib/task/queues'

describe('image queue global concurrency', () => {
  it('defaults to 10', () => {
    expect(readImageQueueGlobalConcurrency(undefined)).toBe(10)
  })

  it.each(['0', '-1', 'abc'])('rejects invalid value %s', (raw) => {
    expect(readImageQueueGlobalConcurrency(raw)).toBe(10)
  })

  it('accepts a positive integer', () => {
    expect(readImageQueueGlobalConcurrency('7')).toBe(7)
  })
})
```

- [ ] **Step 2: Run the test and verify the missing export failure**

Run: `npm.cmd exec vitest run tests/unit/task/image-queue-concurrency.test.ts`

Expected: FAIL because `readImageQueueGlobalConcurrency` is not exported.

- [ ] **Step 3: Implement parsing and BullMQ configuration**

Add to `src/lib/task/queues.ts`:

```ts
const DEFAULT_IMAGE_QUEUE_GLOBAL_CONCURRENCY = 10

export function readImageQueueGlobalConcurrency(raw = process.env.IMAGE_QUEUE_GLOBAL_CONCURRENCY) {
  const parsed = Number.parseInt(raw || '', 10)
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_IMAGE_QUEUE_GLOBAL_CONCURRENCY
}

export async function configureImageQueueGlobalConcurrency() {
  const concurrency = readImageQueueGlobalConcurrency()
  await imageQueue.setGlobalConcurrency(concurrency)
  return concurrency
}
```

In `src/lib/workers/index.ts`, call `await configureImageQueueGlobalConcurrency()` before `createImageWorker()`. Set both `QUEUE_CONCURRENCY_IMAGE=10` and `IMAGE_QUEUE_GLOBAL_CONCURRENCY=10` in `.env` and `.env.example`.

- [ ] **Step 4: Run the focused test and typecheck**

Run: `npm.cmd exec vitest run tests/unit/task/image-queue-concurrency.test.ts`

Expected: PASS.

Run: `npm.cmd run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the isolated concurrency change**

```powershell
git add src/lib/task/queues.ts src/lib/workers/index.ts .env.example tests/unit/task/image-queue-concurrency.test.ts
git commit -m "feat: cap global image concurrency at ten"
```

Keep `.env` as a local runtime change; it is intentionally ignored and must not be committed.

### Task 2: Submit project batches as child image tasks

**Files:**
- Create: `src/lib/image-generation/batch-task-submitter.ts`
- Create: `tests/unit/image-generation/batch-task-submitter.test.ts`
- Modify: `src/lib/assets/services/asset-actions.ts`
- Create: `tests/unit/assets/project-image-batch-actions.test.ts`

**Interfaces:**
- Produces: `ImageBatchMeta = { id: string; index: number; total: number }`
- Produces: `submitImageBatchTasks(input): Promise<{ success: true; async: true; taskId: string; taskIds: string[]; batchId: string; status: string }>`
- Consumes: `submitTask`, `cancelTask`, `removeTaskJob`, Prisma task lookup.

- [ ] **Step 1: Write failing batch submitter tests**

Mock `submitTask`, `cancelTask`, `removeTaskJob`, and `prisma.task.findMany`. Assert that a three-image request:

```ts
expect(submitTaskMock).toHaveBeenCalledTimes(3)
expect(submitTaskMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
  payload: expect.objectContaining({
    count: 1,
    imageIndex: 0,
    batch: { id: expect.any(String), index: 0, total: 3 },
  }),
  dedupeKey: expect.stringContaining(':single:0'),
}))
```

Also assert all children share one batch ID, task IDs are returned in index order, and a regeneration request cancels older active tasks before submitting children.

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm.cmd exec vitest run tests/unit/image-generation/batch-task-submitter.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the batch submitter**

Create a focused module with this public shape:

```ts
export type ImageBatchMeta = {
  id: string
  index: number
  total: number
}

export async function submitImageBatchTasks(input: {
  userId: string
  locale: Locale
  requestId?: string | null
  projectId: string
  type: typeof TASK_TYPE.IMAGE_CHARACTER | typeof TASK_TYPE.IMAGE_LOCATION
  targetType: string
  targetId: string
  payload: Record<string, unknown>
  count: number
  regenerationToken?: string | null
}) {
  const batchId = randomUUID()
  if (input.regenerationToken) {
    const active = await prisma.task.findMany({
      where: {
        userId: input.userId,
        projectId: input.projectId,
        type: input.type,
        targetType: input.targetType,
        targetId: input.targetId,
        status: { in: [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] },
      },
      select: { id: true },
    })
    for (const task of active) {
      await cancelTask(task.id, 'Superseded by a newer image batch')
      await removeTaskJob(task.id).catch(() => false)
    }
  }

  const results = []
  for (let index = 0; index < input.count; index += 1) {
    const suffix = input.regenerationToken
      ? `:regen:${input.regenerationToken}`
      : ''
    results.push(await submitTask({
      userId: input.userId,
      locale: input.locale,
      requestId: input.requestId,
      projectId: input.projectId,
      type: input.type,
      targetType: input.targetType,
      targetId: input.targetId,
      payload: {
        ...input.payload,
        count: 1,
        imageIndex: index,
        batch: { id: batchId, index, total: input.count },
      },
      dedupeKey: `${input.type}:${input.targetId}:single:${index}${suffix}`,
    }))
  }

  const first = results[0]
  return {
    success: true as const,
    async: true as const,
    taskId: first.taskId,
    taskIds: results.map((result) => result.taskId),
    batchId,
    status: first.status,
  }
}
```

Generate one UUID batch ID. When `regenerationToken` is present, query active tasks for the same user/project/type/target, cancel each, and remove waiting/delayed jobs. Submit children sequentially in index order so response ordering is deterministic. Use dedupe keys shaped as `${type}:${targetId}:single:${index}` plus `:regen:${regenerationToken}` when present.

- [ ] **Step 4: Route project multi-image actions through the submitter**

In `submitProjectAssetGenerateTask`, preserve the existing `submitTask` call when `imageIndex !== null` or `count === 1`. Otherwise call `submitImageBatchTasks` with the already validated model payload and UI payload. Do not change global asset submission in this task.

- [ ] **Step 5: Add project asset action behavior tests**

Assert `count: 3` calls `submitImageBatchTasks`, while `imageIndex: 1` calls the existing `submitTask` path. Verify location slots are ensured before batch submission and character children target the appearance ID.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `npm.cmd exec vitest run tests/unit/image-generation/batch-task-submitter.test.ts tests/unit/assets/project-image-batch-actions.test.ts`

Expected: PASS.

Run: `npm.cmd run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit batch submission**

```powershell
git add src/lib/image-generation/batch-task-submitter.ts src/lib/assets/services/asset-actions.ts tests/unit/image-generation/batch-task-submitter.test.ts tests/unit/assets/project-image-batch-actions.test.ts
git commit -m "feat: split image batches into child tasks"
```

### Task 3: Make parallel character child persistence race-safe

**Files:**
- Modify: `src/lib/workers/handlers/character-image-task-handler.ts`
- Modify: `tests/unit/worker/character-image-task-handler.test.ts`

**Interfaces:**
- Produces: a private optimistic compare-and-swap merge for one `imageIndex`.
- Consumes: `characterAppearance.findUnique` and `characterAppearance.updateMany`.

- [ ] **Step 1: Write a failing concurrent persistence test**

Simulate two child jobs completing from the same initial `imageUrls: []`. Make the first compare-and-swap update return `{ count: 0 }`, then refetch an array containing the sibling result and return `{ count: 1 }`. Assert the final update preserves both indexes rather than replacing the sibling.

```ts
expect(prismaMock.characterAppearance.updateMany).toHaveBeenLastCalledWith({
  where: { id: 'appearance-2', imageUrls: JSON.stringify(['cos/index-0.png']) },
  data: expect.objectContaining({
    imageUrls: JSON.stringify(['cos/index-0.png', 'cos/index-1.png']),
  }),
})
```

- [ ] **Step 2: Run the focused test and verify the current full-array update fails it**

Run: `npm.cmd exec vitest run tests/unit/worker/character-image-task-handler.test.ts`

Expected: FAIL because the handler uses `update` with a stale in-memory array.

- [ ] **Step 3: Implement optimistic merge with bounded retries**

For explicit single-index jobs, refetch `imageUrls`, merge only the generated index, and call `updateMany` with the previous serialized value in the `where` clause. Retry the read/merge/update up to five times when `count === 0`; throw `CHARACTER_IMAGE_PERSIST_CONFLICT` after five conflicts. Call `assertTaskActive` immediately before each attempted write.

Retain the legacy group path and its final update for pre-deployment jobs.

- [ ] **Step 4: Run character handler tests**

Run: `npm.cmd exec vitest run tests/unit/worker/character-image-task-handler.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit race-safe persistence**

```powershell
git add src/lib/workers/handlers/character-image-task-handler.ts tests/unit/worker/character-image-task-handler.test.ts
git commit -m "fix: merge parallel character image results safely"
```

### Task 4: Aggregate child task state by newest batch

**Files:**
- Modify: `src/lib/task/state-service.ts`
- Modify: `src/lib/query/hooks/useTaskTargetStateMap.ts`
- Modify: `tests/unit/helpers/task-state-service.test.ts`

**Interfaces:**
- Produces: `TaskBatchState` with `id`, `total`, `queued`, `processing`, `completed`, `failed`, and `failedIndexes`.
- Extends: `TaskTargetState.batch: TaskBatchState | null`.

- [ ] **Step 1: Add failing aggregation tests**

Cover a batch with one completed, one processing, and one queued child. Expect phase `processing`, progress derived from all three children, and batch counts `1/3`. Cover all terminal with one failed and expect phase `failed`, successful count retained, and `failedIndexes` populated. Confirm a legacy task returns `batch: null` and unchanged phase semantics.

- [ ] **Step 2: Run the tests and verify missing batch state failures**

Run: `npm.cmd exec vitest run tests/unit/helpers/task-state-service.test.ts`

Expected: FAIL because `TaskTargetState` has no batch aggregation.

- [ ] **Step 3: Implement batch parsing and aggregation**

Parse `payload.batch` only when ID is non-empty and index/total are valid integers. If the newest task has valid batch metadata, filter tasks to that batch ID and compute:

```ts
phase = processing > 0
  ? 'processing'
  : queued > 0
    ? 'queued'
    : failed > 0
      ? 'failed'
      : 'completed'
```

Completed children contribute 100 to average progress. Failed/canceled children count as failed. Use the newest failed child for `lastError`. For tasks without valid batch metadata, run the legacy resolver and return `batch: null`.

- [ ] **Step 4: Extend the client-side type**

Add the identical optional batch structure to `useTaskTargetStateMap.ts`; no new polling is introduced.

- [ ] **Step 5: Run state tests and typecheck**

Run: `npm.cmd exec vitest run tests/unit/helpers/task-state-service.test.ts tests/unit/optimistic/task-target-state-map.test.ts`

Expected: PASS.

Run: `npm.cmd run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit batch state aggregation**

```powershell
git add src/lib/task/state-service.ts src/lib/query/hooks/useTaskTargetStateMap.ts tests/unit/helpers/task-state-service.test.ts tests/unit/optimistic/task-target-state-map.test.ts
git commit -m "feat: aggregate image batch task state"
```

### Task 5: Verify end-to-end parallel behavior and current-user configuration

**Files:**
- Create: `tests/integration/task/image-batch-parallelism.integration.test.ts`
- Modify only if required by test evidence: batch/concurrency files from Tasks 1-4.

**Interfaces:**
- Verifies: child task isolation, global concurrency, partial success, and supersession.

- [ ] **Step 1: Add integration coverage for three child jobs**

Submit a three-image project batch with mocked generation barriers. Assert all three handlers enter generation before any barrier is released, then release them and verify three distinct image indexes persist.

- [ ] **Step 2: Add global limit coverage**

Queue more than 10 mocked image jobs and track active handler count. Assert the maximum observed count is 10. Use `imageQueue.setGlobalConcurrency(10)` in test setup and restore the prior value in teardown.

- [ ] **Step 3: Add failure isolation and supersession coverage**

Fail index 1 once and verify indexes 0 and 2 are not invoked again when index 1 retries. Cancel an old child before persistence and verify `assertTaskActive` prevents the stale database write.

- [ ] **Step 4: Run the complete targeted suite**

Run:

```powershell
npm.cmd exec vitest run tests/unit/task/image-queue-concurrency.test.ts tests/unit/image-generation/batch-task-submitter.test.ts tests/unit/assets/project-image-batch-actions.test.ts tests/unit/worker/character-image-task-handler.test.ts tests/unit/worker/location-image-task-handler.test.ts tests/unit/helpers/task-state-service.test.ts tests/unit/optimistic/task-target-state-map.test.ts tests/integration/task/image-batch-parallelism.integration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run repository guards and typecheck**

Run: `npm.cmd run check:task-loading`

Expected: PASS.

Run: `npm.cmd run check:no-multiple-sources-of-truth`

Expected: PASS.

Run: `npm.cmd run typecheck`

Expected: PASS.

- [ ] **Step 6: Set the current user's concurrency to 10**

Use Prisma with `.env` loaded to update only the current authenticated user's `UserPreference.imageConcurrency` from its existing value to `10`. Read the row back and print only `userId` and `imageConcurrency`; do not print credentials or other preferences.

- [ ] **Step 7: Commit integration coverage**

```powershell
git add tests/integration/task/image-batch-parallelism.integration.test.ts
git commit -m "test: verify parallel image batch execution"
```

### Task 6: Final verification and operational smoke check

**Files:**
- No planned code changes.

**Interfaces:**
- Verifies: build-time correctness and live queue configuration.

- [ ] **Step 1: Run the full affected unit test groups**

Run: `npm.cmd exec vitest run tests/unit/task tests/unit/worker tests/unit/helpers/task-state-service.test.ts tests/unit/optimistic/task-target-state-map.test.ts`

Expected: PASS.

- [ ] **Step 2: Run typecheck and lint on changed files**

Run: `npm.cmd run typecheck`

Expected: PASS.

Run: `npm.cmd exec eslint src/lib/task/queues.ts src/lib/workers/index.ts src/lib/image-generation/batch-task-submitter.ts src/lib/assets/services/asset-actions.ts src/lib/workers/handlers/character-image-task-handler.ts src/lib/task/state-service.ts src/lib/query/hooks/useTaskTargetStateMap.ts`

Expected: PASS.

- [ ] **Step 3: Restart the development worker through the existing development command**

Restart only the worker process so it reads the new environment values. Do not terminate the Next.js server or unrelated Codex desktop processes.

- [ ] **Step 4: Verify effective queue limits**

Read `imageQueue.getGlobalConcurrency()` and the current user's `imageConcurrency`. Expected values are both `10`. Verify no legacy active image job was modified or deleted by deployment.

- [ ] **Step 5: Run one three-image smoke batch**

Submit one project batch through the existing API/UI and observe three distinct BullMQ child task IDs sharing one batch ID. Confirm up to three Codex image subprocesses start concurrently, each successful image appears independently, and target state reaches `completed` only after all children finish.

- [ ] **Step 6: Review final diff and commits**

Run: `git status --short`, `git diff --check`, and `git log --oneline -8`.

Expected: only pre-existing unrelated dirty files remain; all implementation files are committed and whitespace checks pass.
