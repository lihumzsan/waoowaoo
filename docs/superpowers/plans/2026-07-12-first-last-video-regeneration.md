# First/Last Video Regeneration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a manually edited first/last-frame prompt to regenerate an existing video while retaining the old video until replacement succeeds.

**Architecture:** Treat a successful non-empty manual prompt save as verified for the current source signature. Keep generation eligibility independent from whether a previous video exists, and expose regeneration through explicit button copy.

**Tech Stack:** React 19, TypeScript, Next.js, Vitest, react-dom server rendering.

## Global Constraints

- Preserve the existing video while regeneration runs; replace it only after successful generation.
- Do not bypass real blockers such as active tasks, prompt saves, missing images, missing models, or invalid capability fields.
- Preserve all unrelated dirty-worktree changes.

---

### Task 1: Make a saved manual prompt ready

**Files:**
- Modify: `src/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry.ts`
- Modify: `src/lib/novel-promotion/stages/video-stage-runtime/useFirstLastFramePromptEntries.ts`
- Test: `tests/unit/novel-promotion/first-last-frame-prompt-entry.test.ts`

**Interfaces:**
- Produces: `markSavedUserPromptReady(entry, value, currentSourceSignature): FirstLastFramePromptEntry`
- Consumes: the existing `FirstLastFramePromptEntry` state and current signature from `currentSignaturesRef`.

- [ ] **Step 1: Write the failing state test**

```ts
it('marks a saved manual prompt ready for the current source without queueing regeneration', async () => {
  const { markSavedUserPromptReady, resolvePromptEntryReadiness } = await import(
    '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
  )
  const saved = markSavedUserPromptReady({
    value: 'old', origin: 'generated', dirty: true, status: 'saving', ready: false,
  }, 'new manual prompt', 'source-v2')
  expect(resolvePromptEntryReadiness(saved, 'source-v2')).toMatchObject({
    value: 'new manual prompt', origin: 'user', dirty: false,
    status: 'idle', ready: true, verifiedSourceSignature: 'source-v2',
  })
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm.cmd exec -- vitest run tests/unit/novel-promotion/first-last-frame-prompt-entry.test.ts`

Expected: FAIL because `markSavedUserPromptReady` is not exported.

- [ ] **Step 3: Implement the state transition and use it after persistence**

```ts
export function markSavedUserPromptReady(
  entry: FirstLastFramePromptEntry,
  value: string,
  currentSourceSignature: string,
): FirstLastFramePromptEntry {
  return {
    ...entry,
    value,
    origin: 'user',
    dirty: false,
    status: 'idle',
    ready: true,
    verifiedSourceSignature: currentSourceSignature,
    errorMessage: undefined,
  }
}
```

Use this transition in `savePromptValue` with `currentSignaturesRef.current.get(panelKey) || buildSourceSignature(...)` after the persistence call succeeds.

- [ ] **Step 4: Run the state test and verify GREEN**

Run: `npm.cmd exec -- vitest run tests/unit/novel-promotion/first-last-frame-prompt-entry.test.ts`

Expected: all tests PASS.

### Task 2: Expose an enabled regeneration action

**Files:**
- Modify: `messages/en/video.json`
- Modify: `messages/zh/video.json`
- Modify: `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/panel-card/VideoPanelCardBody.tsx`
- Test: `tests/unit/novel-promotion/video-panel-card-body.test.ts`

**Interfaces:**
- Consumes: `panel.videoGenerationMode`, `panel.videoUrl`, and existing generation blockers.
- Produces: translation key `firstLastFrame.regenerateVideo`.

- [ ] **Step 1: Write the failing render test**

Create a ready linked runtime with `videoGenerationMode: 'firstlastframe'` and a non-empty `videoUrl`. Assert that markup contains the regeneration label and that its action button lacks `disabled`.

- [ ] **Step 2: Run the render test and verify RED**

Run: `npm.cmd exec -- vitest run tests/unit/novel-promotion/video-panel-card-body.test.ts`

Expected: FAIL because the component still renders the generated-state label.

- [ ] **Step 3: Add copy and select it for existing videos**

Add `"regenerateVideo": "Regenerate first/last-frame video"` and `"regenerateVideo": "重新生成首尾帧视频"`. Render that key when `isFirstLastFrameGenerated` is true; keep the existing disabled predicate unchanged so previous video presence never blocks regeneration.

- [ ] **Step 4: Run the render test and verify GREEN**

Run: `npm.cmd exec -- vitest run tests/unit/novel-promotion/video-panel-card-body.test.ts`

Expected: all tests PASS, including active-task blocking tests.

### Task 3: Verify the integrated behavior

**Files:**
- Verify all modified source and test files.

- [ ] **Step 1: Run focused tests**

Run: `npm.cmd exec -- vitest run tests/unit/novel-promotion/first-last-frame-prompt-entry.test.ts tests/unit/novel-promotion/video-panel-card-body.test.ts tests/unit/worker/video-worker.test.ts`

Expected: all tests PASS.

- [ ] **Step 2: Run TypeScript and localization validation**

Run: `npm.cmd run typecheck`

Run: `npm.cmd run check:prompt-i18n`

Expected: both commands exit 0.

- [ ] **Step 3: Inspect the final diff**

Run: `git diff --check` and `git diff -- <modified paths>`.

Expected: no whitespace errors; only the prompt readiness transition, regeneration copy, tests, and Superpowers documents are changed by this task.
