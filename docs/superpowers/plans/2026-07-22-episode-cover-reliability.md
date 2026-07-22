# Episode Cover Reliability Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every Episode own one reliable, pure-image cover generated only by Codex, with project-safe access, bounded validation/retry behavior, correct asset cleanup, and episode-isolated UI state.

**Architecture:** Keep `image_episode_cover` as a dedicated image-queue task and `coverImageMediaId` as the Episode's single current-cover pointer. Pin the handler to the Codex image model, audit each generated image before publishing it, atomically replace the Episode pointer, and reclaim unreferenced media with compensating cleanup. Project-scoped queries protect the API boundary; workflow submission, task polling, and mutation variables close the remaining backend and frontend race windows.

**Tech Stack:** Next.js App Router, TypeScript, React Query, Prisma (MySQL and SQLite schemas), BullMQ, Sharp, Vitest, Codex CLI image generation.

## Global Constraints

- Episode cover generation must always use `CODEX_DEFAULT_IMAGE_MODEL_KEY` (`codex::gpt-image-2`). It must not read `storyboardModel`, select another provider, or fall back to a non-Codex image provider.
- Preserve Codex image execution with `--enable image_generation --sandbox danger-full-access`. Do not add permission, sandbox, filesystem, or environment restrictions to this path.
- Each Episode stores only its current cover through `coverImageMediaId`; do not introduce cover video, cover history, or a second source of truth.
- The final cover must be one continuous pure image with no readable text, title, Episode number, logo, watermark, border, or collage.
- `image_episode_cover` must stay on the image queue and must never call video generation.
- Do not restore or add any “下载全部视频” capability or UI.
- Do not add confirmation dialogs or other interactions before generation or regeneration.
- Preserve unrelated dirty-worktree changes. Each commit must stage only the files listed by its task after reviewing `git diff -- <paths>`.
- This plan fixes the Episode cover path. Project-wide deletion of all other image-provider implementations is a separate cleanup and is outside this change; the cover path itself must have no non-Codex branch or fallback.
- No ZenTao writes are authorized by this plan.

## Business Scope / Out of Scope

### In scope

- Manual and automatic generation of one independent image cover per Episode.
- Codex-only model selection and continued highest Codex execution permission.
- Pure-image output validation, bounded retry behavior, and failure visibility.
- Project ownership for Episode cover reads and mutations.
- Cover media replacement, reset, Episode deletion, and project deletion cleanup.
- Episode-isolated frontend mutation/progress state and terminal-state refresh.
- Batched resolution of Episode audio and cover media references.
- Unit, contract, integration, type, schema, and real Codex smoke verification.

### Out of scope

- Removing every non-Codex image-provider implementation used by unrelated image features.
- Video generation, cover animation, or cover video storage.
- “下载全部视频” restoration or replacement.
- Cover titles, Episode numbers, captions, watermarks, templates, or text overlays.
- Cover version history, user-selectable cover models, or user-selectable cover aspect ratios.
- A new global media garbage collector; this change adds lifecycle handling only for assets touched by the cover flow.

## Acceptance Mapping

| ID | Acceptance criterion | Primary evidence |
|---|---|---|
| AC1 | Every cover request invokes `codex::gpt-image-2` even when the project storyboard model is unset or non-Codex. | Handler unit test and real-task log evidence |
| AC2 | Codex runs with image generation enabled and `danger-full-access`; no video task is created. | Existing Codex client test plus image-chain test |
| AC3 | Project A cannot read, mutate, or delete an Episode owned by Project B, including its cover URL. | Episode route contract tests |
| AC4 | Automatic cover submission is inside the storyboard workflow lease and is attempted before lease completion. | Script-to-storyboard ordering and lease tests |
| AC5 | Only a correctly shaped, single continuous image without forbidden visual text/marks becomes the Episode cover; invalid results fail after at most two attempts. | Audit tests, queue-policy tests, and real-image inspection |
| AC6 | Regeneration retains the old cover until the replacement is validated and linked; candidate failures and superseded covers are cleaned safely. | Handler compensation and media cleanup tests |
| AC7 | Mountain reset, Episode deletion, and project deletion clear cover references and reclaim unreferenced cover media/storage. | Lifecycle tests for each destructive path |
| AC8 | Switching Episodes while a cover task is running cannot leak pending/error state or callbacks, and a terminal polling result refreshes the correct Episode even when SSE was missed. | Hook/component tests and browser smoke |
| AC9 | Listing N Episodes resolves media in batched queries rather than issuing cover/audio lookups per Episode. | Media attachment query-count test |

## Task 1: Pin the Episode Cover Contract to Codex

**Files:**

- Modify: `src/lib/workers/handlers/episode-cover-image-task-handler.ts`
- Modify: `tests/unit/worker/episode-cover-image.test.ts`
- Modify: `tests/contracts/tasktype-behavior-matrix.ts`
- Modify: `tests/integration/chain/image.chain.test.ts`
- Verify: `tests/unit/providers/codex-client.test.ts`

### Step 1: Write the failing handler test

Set the project model fixture to a deliberately non-Codex value and assert that the image source receives the fixed Codex model:

```ts
modelConfigMock.mockResolvedValue({
  storyboardModel: 'other-provider::ignored-model',
})

expect(resolveImageSourceFromGenerationMock).toHaveBeenCalledWith(
  expect.objectContaining({
    modelId: CODEX_DEFAULT_IMAGE_MODEL_KEY,
  }),
)
```

Add a second case with no `storyboardModel`; it must still generate successfully with the same Codex model.

Run:

```bash
npx vitest run tests/unit/worker/episode-cover-image.test.ts
```

Expected: the new assertions fail because the handler currently forwards the project storyboard model or rejects a missing model.

### Step 2: Make the handler Codex-only

Import and use the fixed model key, and remove the storyboard-model requirement:

```ts
import { CODEX_DEFAULT_IMAGE_MODEL_KEY } from '@/lib/providers/codex/constants'

const imageSource = await resolveImageSourceFromGeneration(job, {
  userId: job.data.userId,
  modelId: CODEX_DEFAULT_IMAGE_MODEL_KEY,
  prompt,
  options: {
    referenceImages,
    aspectRatio,
  },
})
```

Keep existing project data loading for prompt context and references, but no project model value may affect cover provider/model selection.

### Step 3: Strengthen task routing contracts

- Map `image_episode_cover` to the direct-submit behavioral contract in `tasktype-behavior-matrix.ts`, not only the generic task-infrastructure contract.
- Add an image-chain test asserting that `IMAGE_EPISODE_COVER` is routed to the image queue/worker and does not call a video generator.
- Keep the existing Codex client assertion for `--enable image_generation` and `--sandbox danger-full-access` unchanged and passing.

Run:

```bash
npx vitest run \
  tests/unit/worker/episode-cover-image.test.ts \
  tests/unit/providers/codex-client.test.ts \
  tests/integration/chain/image.chain.test.ts
```

Expected: all tests pass and the cover model assertion is independent of project model configuration.

### Step 4: Commit the contract boundary

```bash
git add \
  src/lib/workers/handlers/episode-cover-image-task-handler.ts \
  tests/unit/worker/episode-cover-image.test.ts \
  tests/contracts/tasktype-behavior-matrix.ts \
  tests/integration/chain/image.chain.test.ts
git commit -m "fix: pin episode covers to codex image generation"
```

## Task 2: Enforce Project Ownership on Every Episode Route Path

**Files:**

- Modify: `src/app/api/novel-promotion/[projectId]/episodes/[episodeId]/route.ts`
- Modify: `tests/integration/api/contract/novel-promotion-episode-profile.route.test.ts`
- Modify: `tests/integration/api/contract/episode-cover-query.test.ts`

### Step 1: Add cross-project failing tests

For GET, PATCH, and DELETE, authenticate a user for Project A and request an Episode that belongs to Project B. Assert:

- HTTP 404 for every operation.
- GET never returns Project B's `coverImage` or storage URL.
- PATCH does not call an Episode update.
- DELETE does not call an Episode delete.
- The same boundary applies to storyboard/profile loaders used by the response.

Run:

```bash
npx vitest run \
  tests/integration/api/contract/novel-promotion-episode-profile.route.test.ts \
  tests/integration/api/contract/episode-cover-query.test.ts
```

Expected: at least the GET case fails because the current loaders look up Episode data globally by `episodeId`.

### Step 2: Centralize the scoped Episode predicate

Create one route-local predicate and pass `projectId` through all Episode/profile/storyboard loaders:

```ts
function episodeProjectWhere(
  projectId: string,
  episodeId: string,
): Prisma.NovelPromotionEpisodeWhereInput {
  return {
    id: episodeId,
    novelPromotionProject: { projectId },
  }
}
```

Replace global `findUnique({ where: { id: episodeId } })` reads with `findFirst({ where: episodeProjectWhere(projectId, episodeId) })`. Remove the ignored `void projectId` path. Before PATCH or DELETE, resolve the scoped Episode and return 404 when it is absent; only then perform the mutation.

### Step 3: Verify the complete route profile

Run:

```bash
npx vitest run \
  tests/integration/api/contract/novel-promotion-episode-profile.route.test.ts \
  tests/integration/api/contract/episode-cover-query.test.ts \
  tests/integration/api/contract/direct-submit-routes.test.ts
```

Expected: cross-project requests return 404, same-project behavior remains unchanged, and manual cover submission still validates ownership.

### Step 4: Commit the authorization boundary

```bash
git add \
  'src/app/api/novel-promotion/[projectId]/episodes/[episodeId]/route.ts' \
  tests/integration/api/contract/novel-promotion-episode-profile.route.test.ts \
  tests/integration/api/contract/episode-cover-query.test.ts
git commit -m "fix: scope episode cover data to its project"
```

## Task 3: Submit Automatic Covers Before the Storyboard Lease Completes

**Files:**

- Modify: `src/lib/workers/handlers/script-to-storyboard.ts`
- Modify: `tests/unit/worker/script-to-storyboard.test.ts`

### Step 1: Extend the existing lease tests

In `tests/unit/worker/script-to-storyboard.test.ts`, add assertions that:

- Cover submission happens after storyboard persistence/progress reporting but before the lease callback returns.
- No cover task is submitted when the workflow lease is not claimed.
- A cover queue submission error still leaves the storyboard workflow successful, while the task submitter records the cover task failure.

Use an event list to make the ordering explicit:

```ts
expect(events).toEqual([
  'storyboard-persisted',
  'cover-submit-attempted',
  'lease-completed',
])
```

Run:

```bash
npx vitest run tests/unit/worker/script-to-storyboard.test.ts
```

Expected: the ordering case fails against the current post-lease submission.

### Step 2: Move submission inside the lease callback

Move the current cover-submit `try/catch` into `withWorkflowRunLease(...)`, after successful storyboard persistence and before returning from the callback. Retain the warning-and-continue behavior so a cover queue outage does not roll back a completed storyboard.

The cover task submitter remains responsible for creating/marking a failed task when queue submission fails; do not silently replace that task-level evidence with a log-only path.

### Step 3: Verify lease behavior

Run:

```bash
npx vitest run tests/unit/worker/script-to-storyboard.test.ts
```

Expected: all tests pass; cover submission is attempted before lease completion and never occurs without a claimed lease.

### Step 4: Commit the workflow fix

Stage only the implementation and its existing test, then commit:

```bash
git add \
  src/lib/workers/handlers/script-to-storyboard.ts \
  tests/unit/worker/script-to-storyboard.test.ts
git commit -m "fix: submit episode covers within storyboard lease"
```

## Task 4: Audit Pure-Image Output and Bound Retries

**Files:**

- Create: `src/lib/novel-promotion/episode-cover/audit.ts`
- Create: `tests/unit/novel-promotion/episode-cover-audit.test.ts`
- Modify: `src/lib/workers/handlers/episode-cover-image-task-handler.ts`
- Modify: `src/lib/novel-promotion/episode-cover/task.ts`
- Modify: `src/lib/task/queues.ts`
- Create: `tests/unit/task/episode-cover-queue.test.ts`

### Step 1: Specify the audit contract with failing tests

Define tests for:

- Valid Codex local-file/data-URL source, expected aspect ratio, and a clean vision result returns a decoded buffer and metadata.
- Missing dimensions, unreadable or remote HTTP sources, unsupported/oversized payloads, or more than 2% aspect-ratio deviation fail closed.
- Readable text, Episode numbers, logos, watermarks, collages, or a non-continuous scene fail closed.
- Invalid vision JSON and vision runtime errors fail closed.
- Audit failure happens before upload and does not change the existing `coverImageMediaId`.

Use this public shape:

```ts
export type AuditedEpisodeCoverImage = {
  buffer: Buffer
  metadata: {
    mimeType: string
    sizeBytes: number
    width: number
    height: number
  }
}

export async function auditEpisodeCoverImage(params: {
  userId: string
  projectId: string
  imageSource: string | Buffer
  expectedAspectRatio: string
}): Promise<AuditedEpisodeCoverImage>
```

Run:

```bash
npx vitest run tests/unit/novel-promotion/episode-cover-audit.test.ts
```

Expected: tests fail because the audit module does not exist.

### Step 2: Implement deterministic and semantic checks

- Decode the Codex-generated local path, data URL, or buffer once. Reject HTTP(S) sources on this fixed-Codex path instead of downloading provider output.
- Use Sharp metadata for MIME, byte size, width, and height validation.
- Parse the configured aspect ratio and reject relative ratio error greater than 2%.
- Convert the audited bytes to a data URL for the existing vision runtime, then call `executeAiVisionStep` with `model: CODEX_DEFAULT_MODEL_KEY` and require strict JSON:

```json
{
  "hasReadableText": false,
  "hasEpisodeNumber": false,
  "hasLogo": false,
  "hasWatermark": false,
  "isCollage": false,
  "isSingleContinuousScene": true,
  "issues": []
}
```

- Reject unknown/missing fields rather than treating them as clean.
- Return the audited buffer so the handler uploads exactly the bytes that passed validation.

### Step 3: Put the audit before publication

In the handler, perform this order:

1. Generate from Codex.
2. Audit the result.
3. Upload the audited bytes.
4. Create the media row.
5. Replace the Episode pointer.

An audit error must create no storage object, no media row, and no pointer update.

### Step 4: Set a two-attempt policy in both task and queue records

Set `maxAttempts: 2` when submitting `IMAGE_EPISODE_COVER`. In `queues.ts`, add a task-type-specific attempts policy so BullMQ also uses two attempts rather than the general default of five:

```ts
const TASK_TYPE_ATTEMPTS = new Map<TaskType, number>([
  [TASK_TYPE.IMAGE_EPISODE_COVER, 2],
])

const attempts = TASK_TYPE_ATTEMPTS.get(data.type) ?? opts?.attempts
```

Preserve any one-attempt policy that is already stricter for other task classes.

Test that the persisted task and queued job both report two attempts and that no retry becomes a provider fallback.

### Step 5: Verify and commit

Run:

```bash
npx vitest run \
  tests/unit/novel-promotion/episode-cover-audit.test.ts \
  tests/unit/novel-promotion/episode-cover-task.test.ts \
  tests/unit/task/episode-cover-queue.test.ts \
  tests/unit/worker/episode-cover-image.test.ts
```

Expected: all audit, attempt-policy, and handler-ordering tests pass.

```bash
git add \
  src/lib/novel-promotion/episode-cover/audit.ts \
  src/lib/workers/handlers/episode-cover-image-task-handler.ts \
  src/lib/novel-promotion/episode-cover/task.ts \
  src/lib/task/queues.ts \
  tests/unit/novel-promotion/episode-cover-audit.test.ts \
  tests/unit/novel-promotion/episode-cover-task.test.ts \
  tests/unit/task/episode-cover-queue.test.ts \
  tests/unit/worker/episode-cover-image.test.ts
git commit -m "feat: audit codex episode cover images"
```

## Task 5: Make Cover Asset Replacement and Deletion Recoverable

**Files:**

- Create: `src/lib/media/unreferenced-cleanup.ts`
- Create: `tests/unit/media/unreferenced-cleanup.test.ts`
- Modify: `src/lib/workers/handlers/episode-cover-image-task-handler.ts`
- Modify: `tests/unit/worker/episode-cover-image.test.ts`
- Modify: `src/lib/novel-promotion/mountain-reset.ts`
- Modify: `tests/unit/novel-promotion/mountain-reset.test.ts`
- Modify: `src/app/api/novel-promotion/[projectId]/episodes/[episodeId]/route.ts`
- Modify: `src/app/api/novel-promotion/[projectId]/route.ts`
- Modify: `tests/unit/media/episode-cover-media.test.ts`
- Modify: `tests/integration/api/contract/novel-promotion-episode-profile.route.test.ts`
- Modify: `tests/integration/api/contract/crud-routes.test.ts`

### Step 1: Write the cleanup helper tests

Cover these cases:

- Missing media returns `missing` without storage deletion.
- Any remaining Prisma relation count returns `referenced` without deletion.
- Zero references deletes the media row inside a serializable transaction and then deletes the storage object.
- Storage deletion failure never restores or damages a live reference; it throws a typed error containing the storage key for observation/recovery.

Implement a single guarded helper:

```ts
export async function deleteMediaObjectIfUnreferenced(
  mediaId: string,
): Promise<'deleted' | 'referenced' | 'missing'>
```

Load the media object's `storageKey` and Prisma `_count`; treat every relation count, including Episode cover relations, as a reference. Perform the reference check and media-row deletion in a serializable Prisma transaction so a concurrent reference cannot be silently cleared by the schema's `onDelete: SetNull`. Delete storage after the database claim succeeds; if storage deletion fails, log/throw the key as an orphan-cleanup failure rather than risking a broken live reference.

### Step 2: Add replacement compensation tests

In the handler test, assert:

- The prior cover remains linked until the new image passes audit and the new media row is ready.
- Upload failure creates no media row or pointer change.
- Media creation or pointer update failure removes the candidate storage/media when unreferenced and rethrows the original task failure.
- After a successful pointer swap, the previous media is deleted only when it has no remaining references.
- Failure to clean the superseded cover emits a structured warning but does not retry the already-published replacement.

Implement replacement as a small saga rather than a wide database/storage pseudo-transaction: capture the old ID, prepare the candidate, update the pointer, then clean the old ID. Cleanup warnings must include `projectId`, `episodeId`, `taskId`, and `mediaId`, but no prompt or image bytes.

### Step 3: Include covers in reset and destructive paths

- Mountain reset: select `coverImageMediaId`, include it in the media cleanup set, and clear the Episode pointer.
- Episode DELETE: use the scoped Episode record from Task 2, delete the Episode, then call the unreferenced cleanup helper for its former cover.
- Project DELETE: include Episode cover storage keys/media IDs in the existing project deletion collection and cleanup sequence.
- Do not delete media solely by URL; always use the stored media ID/storage key and reference counts.

### Step 4: Verify lifecycle behavior

Run:

```bash
npx vitest run \
  tests/unit/media/unreferenced-cleanup.test.ts \
  tests/unit/media/episode-cover-media.test.ts \
  tests/unit/novel-promotion/mountain-reset.test.ts \
  tests/unit/worker/episode-cover-image.test.ts \
  tests/integration/api/contract/novel-promotion-episode-profile.route.test.ts \
  tests/integration/api/contract/crud-routes.test.ts
```

Expected: replacements, reset, Episode deletion, and project deletion leave no unreferenced cover media/storage under normal storage availability.

### Step 5: Commit the lifecycle change

Review and stage only the files listed above, then commit:

```bash
git add \
  src/lib/media/unreferenced-cleanup.ts \
  src/lib/workers/handlers/episode-cover-image-task-handler.ts \
  src/lib/novel-promotion/mountain-reset.ts \
  'src/app/api/novel-promotion/[projectId]/episodes/[episodeId]/route.ts' \
  'src/app/api/novel-promotion/[projectId]/route.ts' \
  tests/unit/media/unreferenced-cleanup.test.ts \
  tests/unit/media/episode-cover-media.test.ts \
  tests/unit/novel-promotion/mountain-reset.test.ts \
  tests/unit/worker/episode-cover-image.test.ts \
  tests/integration/api/contract/novel-promotion-episode-profile.route.test.ts \
  tests/integration/api/contract/crud-routes.test.ts
git commit -m "fix: clean up episode cover media lifecycle"
```

## Task 6: Isolate Frontend State by Episode and Recover Missed Terminal Events

**Files:**

- Modify: `src/lib/query/mutations/useEpisodeMutations.ts`
- Modify: `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/EpisodeCoverCard.tsx`
- Modify: `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/index.tsx`
- Create: `tests/unit/query/episode-cover-mutation.test.ts`
- Modify: `tests/unit/components/episode-cover-card.test.ts`

### Step 1: Write failing mutation-isolation tests

Refactor the public mutation contract in the test first:

```ts
type GenerateEpisodeCoverVariables = {
  episodeId: string
  hasOutput: boolean
}

const generateCover = useGenerateEpisodeCover(projectId)
generateCover.mutate({ episodeId, hasOutput: Boolean(coverImage) })
```

Invoke the captured mutation callbacks for Episode A after rerendering the UI for Episode B. Assert that:

- The request URL, optimistic task overlay target, invalidation, success handling, and error handling all remain bound to Episode A through callback variables.
- Episode B never inherits A's pending or error presentation.

### Step 2: Make mutation callbacks variable-driven

Remove `episodeId` from the hook closure. Use `variables.episodeId` and `variables.hasOutput` in `mutationFn`, `onMutate`, `onSuccess`, `onError`, and `onSettled` so React Query retains the initiating Episode identity.

Key the cover section/card by `episodeId` in storyboard rendering to reset component-local transient state when the selected Episode changes.

### Step 3: Add polling terminal recovery

Observe the relevant `useTaskTargetStateMap` entry. On a new terminal signature such as `${phase}:${updatedAt}`, invalidate:

```ts
invalidateEpisodeQueries(queryClient, projectId, episodeId)
queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) })
```

Handle both `completed` and `failed`. Use a ref for the last terminal signature to avoid an invalidation loop. This supplements normal SSE invalidation; it must not replace or duplicate optimistic task overlays.

### Step 4: Verify and commit

Run:

```bash
npx vitest run \
  tests/unit/query/episode-cover-mutation.test.ts \
  tests/unit/components/episode-cover-card.test.ts
```

Expected: callbacks and visual state stay bound to the initiating Episode, and a polling-discovered terminal transition invalidates the correct Episode exactly once.

```bash
git add \
  src/lib/query/mutations/useEpisodeMutations.ts \
  'src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/EpisodeCoverCard.tsx' \
  'src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/index.tsx' \
  tests/unit/query/episode-cover-mutation.test.ts \
  tests/unit/components/episode-cover-card.test.ts
git commit -m "fix: isolate episode cover generation state"
```

## Task 7: Batch Episode Media Resolution

**Files:**

- Modify: `src/lib/media/service.ts`
- Modify: `src/lib/media/attach.ts`
- Modify: `src/app/api/novel-promotion/[projectId]/episodes/route.ts`
- Modify: `tests/unit/media/episode-cover-media.test.ts`
- Modify: `tests/integration/api/contract/episode-cover-query.test.ts`

### Step 1: Add the failing query-count test

Return multiple Episodes containing a mix of audio and cover media IDs. Assert that media rows are loaded with one `findMany({ where: { id: { in: [...] } } })` batch rather than per-Episode cover/audio `findUnique` calls.

Retain compatibility assertions for legacy Episodes whose audio uses the existing fallback source.

### Step 2: Implement batch attachment

Add a service function that deduplicates IDs and maps rows once:

```ts
export async function getMediaObjectsByIds(ids: string[]) {
  const uniqueIds = [...new Set(ids.filter(Boolean))]
  if (uniqueIds.length === 0) return new Map<string, MediaRef>()

  const rows = await mediaModel.findMany({
    where: { id: { in: uniqueIds } },
  })

  return new Map(rows.map((row) => [row.id, mapMediaObjectToRef(row)]))
}
```

Add `attachMediaFieldsToEpisodes(episodes)` to collect audio/cover IDs, call the batch service once, and attach both fields. Use the legacy audio fallback only for unresolved legacy audio values. Update the Episodes list route to call the batch function rather than attaching each Episode independently.

### Step 3: Verify and commit

Run:

```bash
npx vitest run \
  tests/unit/media/episode-cover-media.test.ts \
  tests/integration/api/contract/episode-cover-query.test.ts
```

Expected: the returned API shape is unchanged, cover URLs remain present, and N Episodes use one batched media lookup.

```bash
git add \
  src/lib/media/service.ts \
  src/lib/media/attach.ts \
  'src/app/api/novel-promotion/[projectId]/episodes/route.ts' \
  tests/unit/media/episode-cover-media.test.ts \
  tests/integration/api/contract/episode-cover-query.test.ts
git commit -m "perf: batch episode cover media resolution"
```

## Task 8: Run Full Verification and Real Codex Acceptance

**Files:**

- Verify all files changed by Tasks 1–7.
- Do not create fixture files in tracked paths for manual verification.

### Step 1: Run targeted cover tests

```bash
npx vitest run \
  tests/unit/providers/codex-client.test.ts \
  tests/unit/worker/episode-cover-image.test.ts \
  tests/unit/novel-promotion/episode-cover-audit.test.ts \
  tests/unit/novel-promotion/episode-cover-task.test.ts \
  tests/unit/novel-promotion/mountain-reset.test.ts \
  tests/unit/task/episode-cover-queue.test.ts \
  tests/unit/media/unreferenced-cleanup.test.ts \
  tests/unit/media/episode-cover-media.test.ts \
  tests/unit/query/episode-cover-mutation.test.ts \
  tests/unit/components/episode-cover-card.test.ts \
  tests/integration/api/contract/episode-cover-query.test.ts \
  tests/integration/api/contract/novel-promotion-episode-profile.route.test.ts \
  tests/integration/api/contract/direct-submit-routes.test.ts \
  tests/integration/chain/image.chain.test.ts
```

Expected: all cover-targeted tests pass. If a full shared suite exposes a pre-existing mock incompatibility, record the exact failing test and rerun it against the branch base before classifying it as unrelated.

### Step 2: Run static, schema, and contract guards

```bash
npm run check:test-coverage-guards
npm run typecheck
npx prisma validate --schema prisma/schema.prisma
DATABASE_URL='file:/tmp/waoowaoo-episode-cover-validation.db' \
  npx prisma validate --schema prisma/schema.sqlit.prisma
npm run build
git diff --check
```

Expected: all commands pass. If `npm run build` needs a local-only environment value, provide it from the existing local environment/credential boundary and record the missing prerequisite; do not add secrets to tracked files.

### Step 3: Perform a real Codex image smoke test

Using the existing locally configured application and worker:

1. Prepare two Episodes with visibly different story context.
2. Set the project storyboard model to a non-Codex value or leave it unset.
3. Generate both covers and verify task evidence reports `codex::gpt-image-2` with `danger-full-access`.
4. Verify the two Episodes receive distinct `coverImageMediaId` values and no video task/job is created.
5. Inspect both images: one continuous image, correct configured aspect ratio, no readable text/title/Episode number/logo/watermark/collage.
6. Switch rapidly between Episode A and B while A is running; confirm no pending/error state bleed.
7. Interrupt SSE or reconnect after completion; confirm terminal polling refreshes the correct cover.
8. Regenerate A; verify the old media/storage is reclaimed only after the new pointer is committed.
9. Run mountain reset, Episode deletion, and project deletion on disposable fixtures; verify cover references and unreferenced storage objects are removed.

Record task IDs, model ID, storage/media before-and-after counts, and screenshots in the delivery record. Do not retain disposable tracked fixtures.

### Step 4: Review final diff and commit verification-only adjustments

```bash
git status --short
git diff --stat
git diff --check
```

Expected: only approved cover-related paths are part of this delivery; unrelated user changes remain unstaged and unmodified.

If verification required test-only corrections, stage only those exact files and commit:

```bash
git commit -m "test: verify episode cover reliability"
```

## Risks, Rollback and Observation

### Risks

- Vision audit adds one Codex call and latency per generated candidate. The two-attempt cap bounds cost and prevents the current five-attempt amplification.
- Storage and database writes cannot form one transaction. Candidate compensation and reference-counted cleanup reduce leaks, but a storage outage can still leave an observable orphan for later cleanup.
- Deleting shared media without checking every relation can break other assets. The cleanup helper must fail safe when any Prisma relation count is non-zero.
- Moving automatic submission into the workflow lease increases lease duration by the queue-submission latency, not by image-generation time. The image job remains asynchronous.
- Terminal polling invalidation can loop if it is based only on phase. The `(phase, updatedAt)` signature/ref prevents repeated invalidation.
- Strict visual audit can reject artistically valid images. Structured issue logging and the bounded retry result provide evidence for threshold tuning without silently publishing non-compliant covers.

### Rollback

- Tasks are commit-separated so the latest task can be reverted without reverting schema or unrelated Episode functionality.
- If semantic auditing is operationally unstable, revert Task 4's audit commit while retaining Task 1's Codex pin, Task 2's authorization fix, and Task 5's lifecycle cleanup.
- If batch attachment changes response behavior, revert Task 7 independently; the single-Episode attachment path remains the compatibility fallback.
- Do not roll back by restoring a non-Codex provider fallback or lowering Codex permissions; surface the task failure instead.

### Observation

- Log cover generation start/success/failure with `taskId`, `projectId`, `episodeId`, fixed `modelId`, attempt, audit result category, and media ID. Never log prompts, credentials, data URLs, or image bytes.
- Emit a structured warning for compensation/cleanup failures with storage key metadata safe for internal logs.
- Compare submitted, completed, failed, and retry counts specifically for `image_episode_cover` after rollout.
- Track audit-rejection categories separately from provider/runtime failures.
- During acceptance, verify database pointer state, media row state, storage state, queue task state, and rendered UI as separate evidence layers.

## Delivery Metadata

- Plan status: Proposed
- Evidence profile: Standard
- Story ID: None
- Task IDs: None
- Task sync map: not-synced
- ZenTao sync status: not-synced; no write authorization was provided
- ZenTao readback: None
- OpenSpec/taskID artifact: None present in this repository
- Last updated: 2026-07-22

## Delivery Record

### Implementation status

- Not started. This document is the unique implementation plan; no business code is changed by plan creation.

### Verification evidence

- Not started. Record exact commands, exit status, and any base-branch comparison here during execution.

### Real Codex acceptance evidence

- Not started. Record task IDs, fixed model ID, permission evidence, screenshots, and media/storage before-and-after counts here.

### Deviations

- None recorded.

### Commits

- None recorded.

### Rollback or follow-up items

- None recorded.
