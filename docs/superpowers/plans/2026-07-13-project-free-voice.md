# Project Free Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a project-persistent, ComfyUI-only free-voice area that stores multiple immutable text records, multiple generated versions per record, and permanently keeps only a user-selected version on request.

**Architecture:** Free voice uses two new Prisma models and a dedicated API/service path; it never creates or updates formal `NovelPromotionVoiceLine` rows. API routes create immutable records/versions and submit `FREE_VOICE` jobs to the existing voice queue, while the voice worker runs the existing ComfyUI audio client and stores stable `MediaObject` references. A sibling `FreeVoicePanel` owns its own React Query cache and overlays existing task-target state for live queued/processing/failed status.

**Tech Stack:** Next.js App Router, TypeScript, React Query, Prisma/MySQL, BullMQ, ComfyUI, Vitest, next-intl.

## Global Constraints

- Version 1 supports ComfyUI only; do not add Fal, Bailian, or cross-provider compatibility.
- A record's text, character snapshot, voice snapshot, and reference audio are immutable after creation.
- A project may contain many records; a record may contain many versions, numbered from 1.
- Free voice never enters formal dialogue, storyboard, subtitle, timeline, or batch voice-generation data.
- Selecting a character immediately adopts that character's reference audio; a manually selected global voice affects only the new record.
- Only voices with reference audio may be used.
- Task target is `NovelPromotionFreeVoiceVersion`; task type is `free_voice`.
- Destructive keep/delete operations are rejected while a record has queued or processing free-voice tasks.
- Object-storage deletion must succeed before corresponding database rows are deleted.
- Use `npm.cmd` and `npx.cmd` on Windows.

---

## File Structure

- `prisma/schema.prisma` and a dated migration define record/version persistence and media relations.
- `src/lib/voice/free-voice.ts` owns validation, serialization, version allocation, submission compensation, cleanup, and ComfyUI generation.
- `src/lib/voice/comfyui-voice-workflow.ts` owns the shared multi-person-to-single-person workflow fallback.
- `src/app/api/novel-promotion/[projectId]/free-voices/**/route.ts` exposes list/create/regenerate/keep/delete operations.
- `src/lib/task/*` and `src/lib/workers/voice.worker.ts` register and execute `FREE_VOICE` jobs.
- `src/lib/query/hooks/useFreeVoices.ts` and `src/lib/query/mutations/useFreeVoiceMutations.ts` provide isolated cache operations.
- `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video-stage/FreeVoicePanel.tsx` owns the composer, record cards, version selection, playback, download, confirmation, and live task overlay.
- `src/lib/novel-promotion/stages/video-stage-runtime-core.tsx` mounts the panel below formal dialogue voice.

### Task 1: Persistence Contract

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260713090000_add_project_free_voice/migration.sql`
- Create: `tests/unit/voice/free-voice-schema.test.ts`

**Interfaces:**
- Produces: Prisma delegates `novelPromotionFreeVoiceRecord` and `novelPromotionFreeVoiceVersion`.
- Produces: record relation `versions` and optional media relations `referenceAudioMedia` / `audioMedia`.

- [ ] **Step 1: Write the failing schema contract test**

```ts
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('free voice Prisma contract', () => {
  const schema = fs.readFileSync('prisma/schema.prisma', 'utf8')
  const migration = fs.readFileSync(
    'prisma/migrations/20260713090000_add_project_free_voice/migration.sql',
    'utf8',
  )

  it('defines project records, unique versions, and cascading ownership', () => {
    expect(schema).toContain('model NovelPromotionFreeVoiceRecord')
    expect(schema).toContain('model NovelPromotionFreeVoiceVersion')
    expect(schema).toContain('@@unique([recordId, versionNumber])')
    expect(migration).toContain('novel_promotion_free_voice_records')
    expect(migration).toContain('novel_promotion_free_voice_versions')
  })
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx.cmd vitest run tests/unit/voice/free-voice-schema.test.ts`

Expected: FAIL because the migration and models do not exist.

- [ ] **Step 3: Add the two models, reverse relations, indexes, and MySQL migration**

Use the exact fields and relation names from `docs/superpowers/specs/2026-07-13-free-voice-design.md`, including `@@unique([recordId, versionNumber])`, `onDelete: Cascade` for project/record ownership, and `onDelete: SetNull` for media references.

- [ ] **Step 4: Validate and verify GREEN**

Run: `npx.cmd prisma validate && npx.cmd vitest run tests/unit/voice/free-voice-schema.test.ts`

Expected: Prisma schema valid; 1 test passes.

- [ ] **Step 5: Commit**

```powershell
git add prisma/schema.prisma prisma/migrations/20260713090000_add_project_free_voice/migration.sql tests/unit/voice/free-voice-schema.test.ts
git commit -m "feat: persist project free voice records"
```

### Task 2: ComfyUI Free-Voice Generator

**Files:**
- Create: `src/lib/voice/comfyui-voice-workflow.ts`
- Create: `src/lib/voice/free-voice.ts`
- Modify: `src/lib/voice/generate-voice-line.ts`
- Create: `tests/unit/voice/free-voice.test.ts`
- Modify: `tests/unit/voice/generate-voice-line.test.ts`

**Interfaces:**
- Produces: `resolveComfyUiSingleVoiceWorkflowKey(modelId: string): string`.
- Produces: `generateFreeVoiceVersion(input: { projectId: string; versionId: string; userId: string; locale: Locale }): Promise<{ versionId: string; audioUrl: string }>`.
- Consumes: `runComfyUiAudioWorkflow`, `uploadObject`, `ensureMediaObjectFromStorageKey`, and stored record snapshots.

- [ ] **Step 1: Write failing unit tests**

Cover: multi-person workflow fallback; prompt equals immutable record text; exactly one reference URL; upload key equals `voice/free/<project>/<record>/<version>.<ext>`; version receives model, stable URL/media ID, and duration; missing record/version fails before ComfyUI is called.

```ts
expect(resolveComfyUiSingleVoiceWorkflowKey('baseaudio/多人/LongCat-two'))
  .toBe('baseaudio/单人/LongCat-one')
expect(runComfyUiAudioWorkflowMock).toHaveBeenCalledWith(expect.objectContaining({
  prompt: '需要朗读的文字',
  referenceAudioUrls: ['media/reference.wav'],
}))
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npx.cmd vitest run tests/unit/voice/free-voice.test.ts tests/unit/voice/generate-voice-line.test.ts`

Expected: FAIL because the shared resolver and generator do not exist.

- [ ] **Step 3: Extract the shared workflow fallback without changing formal voice behavior**

```ts
const FALLBACKS: Record<string, string> = {
  'baseaudio/多人/LongCat-two': 'baseaudio/单人/LongCat-one',
  'baseaudio/多人/s2-two': 'baseaudio/单人/s2-one',
  'baseaudio/三人/s2-three': 'baseaudio/单人/s2-one',
}
export function resolveComfyUiSingleVoiceWorkflowKey(modelId: string) {
  return FALLBACKS[modelId] || modelId
}
```

- [ ] **Step 4: Implement `generateFreeVoiceVersion` with ComfyUI-only validation and stable media persistence**

The function must re-read the version, record, and owning project; reject a non-ComfyUI model; run the single-voice workflow; upload the decoded audio; create/reuse its `MediaObject`; and update only the requested version.

- [ ] **Step 5: Run generator and formal-voice regression tests**

Run: `npx.cmd vitest run tests/unit/voice/free-voice.test.ts tests/unit/voice/generate-voice-line.test.ts`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/voice/comfyui-voice-workflow.ts src/lib/voice/free-voice.ts src/lib/voice/generate-voice-line.ts tests/unit/voice/free-voice.test.ts tests/unit/voice/generate-voice-line.test.ts
git commit -m "feat: generate free voice with ComfyUI"
```

### Task 3: Queue and Worker Integration

**Files:**
- Modify: `src/lib/task/types.ts`
- Modify: `src/lib/task/queues.ts`
- Modify: `src/lib/task/intent.ts`
- Modify: `src/lib/task/progress-message.ts`
- Modify: `src/lib/workers/voice.worker.ts`
- Modify: `messages/zh/progress.json`
- Modify: `messages/en/progress.json`
- Modify: `tests/unit/worker/voice-worker.test.ts`

**Interfaces:**
- Produces: `TASK_TYPE.FREE_VOICE = 'free_voice'` routed to the voice queue.
- Worker consumes payload `{ versionId: string }` and invokes `generateFreeVoiceVersion`.

- [ ] **Step 1: Add a failing worker dispatch test**

```ts
const job = buildJob({
  type: TASK_TYPE.FREE_VOICE,
  targetType: 'NovelPromotionFreeVoiceVersion',
  targetId: 'version-1',
  episodeId: null,
})
await processor!(job)
expect(generateFreeVoiceVersionMock).toHaveBeenCalledWith({
  projectId: 'project-1', versionId: 'version-1', userId: 'user-1', locale: 'zh',
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npx.cmd vitest run tests/unit/worker/voice-worker.test.ts`

Expected: FAIL because `FREE_VOICE` is not registered.

- [ ] **Step 3: Register the task, intent, queue, progress labels, and worker branch**

The worker reports `generate_free_voice_submit` before generation and `generate_free_voice_persist` after persistence.

- [ ] **Step 4: Run worker and task coverage checks**

Run: `npx.cmd vitest run tests/unit/worker/voice-worker.test.ts && npm.cmd run check:test-tasktype-coverage`

Expected: worker suite and task-type coverage pass.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/task src/lib/workers/voice.worker.ts messages/zh/progress.json messages/en/progress.json tests/unit/worker/voice-worker.test.ts
git commit -m "feat: dispatch free voice tasks"
```

### Task 4: Free-Voice CRUD and Generation APIs

**Files:**
- Modify: `src/lib/voice/free-voice.ts`
- Create: `src/app/api/novel-promotion/[projectId]/free-voices/route.ts`
- Create: `src/app/api/novel-promotion/[projectId]/free-voices/[recordId]/route.ts`
- Create: `src/app/api/novel-promotion/[projectId]/free-voices/[recordId]/versions/route.ts`
- Create: `src/app/api/novel-promotion/[projectId]/free-voices/[recordId]/keep-version/route.ts`
- Create: `tests/integration/api/specific/free-voices-route.test.ts`

**Interfaces:**
- Produces: `GET/POST /free-voices`, `DELETE /free-voices/:recordId`, `POST /versions`, and `POST /keep-version`.
- List response: `{ records: FreeVoiceRecordDto[] }`, with versions sorted descending and current task summaries.
- Create response: `{ record, taskId }`; regenerate response: `{ version, taskId }`.

- [ ] **Step 1: Write failing route tests**

Cover ownership, trimmed nonempty text, server-side character/global-voice resolution, reference-audio requirement, ComfyUI-only rejection, version allocation, create+submit compensation, active-task deletion block, cross-record keep rejection, storage-first cleanup, idempotent deletion, and descending list order.

```ts
expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
  type: TASK_TYPE.FREE_VOICE,
  targetType: 'NovelPromotionFreeVoiceVersion',
  targetId: 'version-1',
}))
expect(source).toMatch(/rollback|compensat/i)
```

- [ ] **Step 2: Run and verify RED**

Run: `npx.cmd vitest run tests/integration/api/specific/free-voices-route.test.ts`

Expected: FAIL because routes do not exist.

- [ ] **Step 3: Implement service operations and thin authenticated route handlers**

Create uses one transaction for record/version 1, then submits the task; on submission failure it runs explicit compensation deleting that new record. Regeneration allocates `max(versionNumber) + 1` inside a transaction and compensates only the new version. Keep/delete query active `FREE_VOICE` tasks and delete storage objects before DB rows and unreferenced media rows.

- [ ] **Step 4: Run route and guard checks**

Run: `npx.cmd vitest run tests/integration/api/specific/free-voices-route.test.ts && npm.cmd run check:test-route-coverage && npm.cmd run check:task-submit-compensation`

Expected: API suite and both guards pass.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/voice/free-voice.ts src/app/api/novel-promotion/[projectId]/free-voices tests/integration/api/specific/free-voices-route.test.ts
git commit -m "feat: add project free voice APIs"
```

### Task 5: Query Cache and Client Operations

**Files:**
- Modify: `src/lib/query/keys.ts`
- Create: `src/lib/query/hooks/useFreeVoices.ts`
- Create: `src/lib/query/mutations/useFreeVoiceMutations.ts`
- Modify: `src/lib/query/hooks/index.ts`
- Modify: `src/lib/query/mutations/index.ts`
- Create: `tests/unit/query/free-voice-query-contract.test.ts`

**Interfaces:**
- Produces: `queryKeys.freeVoices.all(projectId)`.
- Produces: `useFreeVoices(projectId)`, `useCreateFreeVoice`, `useGenerateFreeVoiceVersion`, `useKeepFreeVoiceVersion`, and `useDeleteFreeVoiceRecord`.
- Produces shared DTO types `FreeVoiceRecord`, `FreeVoiceVersion`, and `FreeVoiceTaskState`.

- [ ] **Step 1: Write a failing query contract test**

Verify the isolated query key, endpoint paths, and invalidation scope; free-voice mutations must never invalidate `voiceLines` or storyboard keys.

- [ ] **Step 2: Run and verify RED**

Run: `npx.cmd vitest run tests/unit/query/free-voice-query-contract.test.ts`

Expected: FAIL because the hooks and key do not exist.

- [ ] **Step 3: Implement query and mutations using existing `apiRequest` and React Query patterns**

Every successful mutation invalidates only `queryKeys.freeVoices.all(projectId)`. Creation returns immediately with its queued version so the panel can clear the composer and refetch.

- [ ] **Step 4: Run the query contract test**

Run: `npx.cmd vitest run tests/unit/query/free-voice-query-contract.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/query tests/unit/query/free-voice-query-contract.test.ts
git commit -m "feat: add free voice query hooks"
```

### Task 6: Independent Free-Voice Panel

**Files:**
- Create: `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video-stage/free-voice-state.ts`
- Create: `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video-stage/FreeVoicePanel.tsx`
- Modify: `src/app/[locale]/workspace/asset-hub/components/VoicePickerDialog.tsx`
- Modify: `src/lib/novel-promotion/stages/video-stage-runtime-core.tsx`
- Modify: `messages/zh/voice.json`
- Modify: `messages/en/voice.json`
- Create: `tests/unit/voice/free-voice-ui-state.test.ts`

**Interfaces:**
- Produces pure helpers `selectCharacterDefaultVoice(character)`, `canSubmitFreeVoice(draft)`, and `safeFreeVoiceFilename(record, version)`.
- `VoicePickerDialog` gains optional `referenceAudioOnly?: boolean`, filtering out voices without `customVoiceUrl` when true.
- `FreeVoicePanel` consumes only `projectId`; it owns independent expansion and selection state.

- [ ] **Step 1: Write failing UI-state tests**

```ts
expect(selectCharacterDefaultVoice({ id: 'c1', name: '角色', customVoiceUrl: '/m/a' }))
  .toMatchObject({ sourceType: 'character', sourceId: 'c1', referenceAudioUrl: '/m/a' })
expect(canSubmitFreeVoice({ text: '  ', characterId: 'c1', voice: validVoice })).toBe(false)
expect(safeFreeVoiceFilename(record, version)).toMatch(/free-voice-.*-v3\.mp3$/)
```

- [ ] **Step 2: Run and verify RED**

Run: `npx.cmd vitest run tests/unit/voice/free-voice-ui-state.test.ts`

Expected: FAIL because helpers do not exist.

- [ ] **Step 3: Implement pure state helpers and reference-audio filtering**

Selecting a character replaces the draft voice with its current `customVoiceUrl`; manual global voice selection changes only draft voice fields.

- [ ] **Step 4: Build and mount `FreeVoicePanel`**

The accordion header displays record/running counts. The expanded body contains character selector, voice selector, text area, disabled-reason copy, and generate button, followed by newest-first record cards. Each card has full-text expansion, immutable snapshots, newest-first versions, radio selection, task status/error, audio controls, download, regenerate, keep-only-selected confirmation, and delete confirmation. Use `useTaskTargetStateMap(projectId, version targets)` so refreshed pages recover task state.

- [ ] **Step 5: Run UI-state and TypeScript checks**

Run: `npx.cmd vitest run tests/unit/voice/free-voice-ui-state.test.ts && npm.cmd run typecheck`

Expected: UI-state tests and TypeScript pass.

- [ ] **Step 6: Commit**

```powershell
git add src/app/[locale]/workspace src/lib/novel-promotion/stages/video-stage-runtime-core.tsx messages/zh/voice.json messages/en/voice.json tests/unit/voice/free-voice-ui-state.test.ts
git commit -m "feat: add independent free voice panel"
```

### Task 7: Project Cleanup and Media Safety

**Files:**
- Modify: `src/app/api/projects/[projectId]/route.ts`
- Create: `tests/unit/voice/free-voice-cleanup.test.ts`
- Modify: `tests/integration/api/specific/assets-route.test.ts`

**Interfaces:**
- Project deletion collects every free-voice version audio storage key before deleting the project.
- Cleanup deletes `MediaObject` only after confirming no remaining business relation uses it.

- [ ] **Step 1: Write failing cleanup tests**

Verify project deletion includes free-voice audio keys and keep/delete retains media metadata if referenced elsewhere.

- [ ] **Step 2: Run and verify RED**

Run: `npx.cmd vitest run tests/unit/voice/free-voice-cleanup.test.ts tests/integration/api/specific/assets-route.test.ts`

Expected: FAIL because project cleanup does not include free-voice versions.

- [ ] **Step 3: Extend project storage-key collection and media reference checks**

Include `freeVoiceRecords.versions.audioUrl` in the existing novel-promotion query and resolve each value through `resolveStorageKeyFromMediaValue`.

- [ ] **Step 4: Run cleanup tests**

Run: `npx.cmd vitest run tests/unit/voice/free-voice-cleanup.test.ts tests/integration/api/specific/assets-route.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/app/api/projects/[projectId]/route.ts tests/unit/voice/free-voice-cleanup.test.ts tests/integration/api/specific/assets-route.test.ts
git commit -m "fix: clean up project free voice media"
```

### Task 8: Migration, Regression, and Live Verification

**Files:**
- Modify only files required by verification findings; do not include unrelated pre-existing failures.

**Interfaces:**
- Produces a generated Prisma client and migrated active database.
- Confirms the real app route renders and the new API/worker path is reachable.

- [ ] **Step 1: Stop only the repository's active dev processes, generate Prisma client, deploy migration, and restart the normal full launcher**

Run after identifying processes by command line:

```powershell
npx.cmd prisma generate
npx.cmd prisma migrate deploy
```

Expected: client generation succeeds and Prisma reports the database schema is up to date. Restart `C:\work\workspace\start-waoowaoo-dev.bat` using its normal full `npm run dev` path.

- [ ] **Step 2: Run focused regression suites**

```powershell
$env:BILLING_TEST_BOOTSTRAP='0'
npx.cmd vitest run tests/unit/voice tests/unit/worker/voice-worker.test.ts tests/unit/query/free-voice-query-contract.test.ts tests/integration/api/specific/free-voices-route.test.ts tests/integration/api/specific/assets-route.test.ts
```

Expected: all focused suites pass.

- [ ] **Step 3: Run repository guards and compile checks**

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run check:test-tasktype-coverage
npm.cmd run check:test-route-coverage
npm.cmd run check:task-submit-compensation
```

Expected: all commands exit 0. If the two known unrelated direct-submit image tests still fail, record them separately with exact names and do not alter image-generation code.

- [ ] **Step 4: Live sanity check**

Open a real project’s 成片 page and verify: free-voice accordion below 台词配音; character auto-voice; two independent records persist; one record can create three versions; playback and download work; keep-only-selected leaves one version after refresh; formal dialogue/storyboard/subtitle data remains unchanged.

- [ ] **Step 5: Review branch diff and commit any verification-only corrections**

```powershell
git status --short
git diff --check
git log --oneline main..HEAD
```

Expected: no whitespace errors, no accidental generated/cache files, and only free-voice-related commits.
