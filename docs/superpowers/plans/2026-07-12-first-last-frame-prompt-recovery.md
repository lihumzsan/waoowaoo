# First/Last-Frame Prompt Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep completed transition prompts ready for first/last-frame video generation and make deterministic fallback prompt generation idempotent.

**Architecture:** Extract a canonical client source-signature helper that serializes only the shared server-compatible fingerprint input, then make the runtime hook use it. Separately, make the deterministic fallback builder consume only original panel action fields so an existing generated bridge can never become its own input.

**Tech Stack:** TypeScript, React hooks, Vitest, Prisma-backed worker tests.

## Global Constraints

- No database migration or API contract expansion.
- Do not weaken stale-prompt safeguards.
- Do not change unrelated video generation, model configuration, or visual layout.
- Use test-driven development and observe each regression test fail before production changes.

---

### Task 1: Stabilize transition-prompt readiness signatures

**Files:**
- Modify: `src/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry.ts`
- Modify: `src/lib/novel-promotion/stages/video-stage-runtime/useFirstLastFramePromptEntries.ts`
- Modify: `src/lib/novel-promotion/stages/video-stage-runtime/useVideoFirstLastFrameFlow.ts`
- Test: `tests/unit/novel-promotion/first-last-frame-prompt-entry.test.ts`

**Interfaces:**
- Consumes: `buildFirstLastFramePromptFingerprintInput({ firstPanel, lastPanel })`.
- Produces: `buildFirstLastFramePromptSourceSignature(firstPanel, lastPanel): string`.

- [ ] **Step 1: Write the failing canonical-signature test**

Add a test importing `buildFirstLastFramePromptSourceSignature`. Construct two panel inputs, call the helper twice, and assert the result equals `JSON.stringify({ canonical: buildFirstLastFramePromptFingerprintInput(...) })`. Also mutate a real source field and assert the signature changes. The desired API intentionally has no selected-model parameter.

```ts
it('builds readiness from canonical panel sources without UI model state', async () => {
  const { buildFirstLastFramePromptSourceSignature } = await import(
    '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
  )
  const { buildFirstLastFramePromptFingerprintInput } = await import(
    '@/lib/novel-promotion/first-last-frame-prompt-fingerprint'
  )
  const firstPanel = { id: 'first', imageUrl: 'first.png', videoPrompt: 'walk forward', duration: 6 }
  const lastPanel = { id: 'last', imageUrl: 'last.png', videoPrompt: 'stop by the door' }

  expect(buildFirstLastFramePromptSourceSignature(firstPanel, lastPanel)).toBe(JSON.stringify({
    canonical: buildFirstLastFramePromptFingerprintInput({ firstPanel, lastPanel }),
  }))
  expect(buildFirstLastFramePromptSourceSignature(
    { ...firstPanel, videoPrompt: 'turn around' },
    lastPanel,
  )).not.toBe(buildFirstLastFramePromptSourceSignature(firstPanel, lastPanel))
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx.cmd vitest run tests/unit/novel-promotion/first-last-frame-prompt-entry.test.ts`

Expected: FAIL because `buildFirstLastFramePromptSourceSignature` is not exported.

- [ ] **Step 3: Implement the minimal canonical signature helper and use it**

In `first-last-frame-prompt-entry.ts`, import `buildFirstLastFramePromptFingerprintInput` and its panel type, then add:

```ts
export function buildFirstLastFramePromptSourceSignature(
  firstPanel: FirstLastFrameFingerprintPanel,
  lastPanel: FirstLastFrameFingerprintPanel,
) {
  return JSON.stringify({
    canonical: buildFirstLastFramePromptFingerprintInput({ firstPanel, lastPanel }),
  })
}
```

In `useFirstLastFramePromptEntries.ts`, replace the inline `JSON.stringify({ canonical, selectedModel: flModel })` construction with this helper. Remove `flModel` from the hook parameters and dependencies because the canonical fingerprint already includes the fixed workflow identity. In `useVideoFirstLastFrameFlow.ts`, stop passing `flModel` into `useFirstLastFramePromptEntries`; the selected model remains in the video-generation flow itself.

- [ ] **Step 4: Run the focused prompt-entry test and verify GREEN**

Run: `npx.cmd vitest run tests/unit/novel-promotion/first-last-frame-prompt-entry.test.ts`

Expected: all tests in the file PASS.

- [ ] **Step 5: Commit the readiness fix**

```powershell
git add -- src/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry.ts src/lib/novel-promotion/stages/video-stage-runtime/useFirstLastFramePromptEntries.ts src/lib/novel-promotion/stages/video-stage-runtime/useVideoFirstLastFrameFlow.ts tests/unit/novel-promotion/first-last-frame-prompt-entry.test.ts
git commit -m "fix(video): stabilize transition prompt readiness"
```

### Task 2: Make deterministic fallback prompts idempotent

**Files:**
- Modify: `src/lib/novel-promotion/panel-continuity.ts`
- Test: `tests/unit/novel-promotion/panel-continuity.test.ts`
- Test: `tests/unit/worker/first-last-frame-prompt.test.ts`

**Interfaces:**
- Consumes: `pickPanelContinuityActionText(panel)`.
- Produces: unchanged `buildDefaultFirstLastFramePrompt({ firstPanel, lastPanel }): string`, now idempotent with respect to `firstLastFramePrompt`.

- [ ] **Step 1: Write the failing fallback-idempotency test**

Add a panel-continuity test where the first panel has both an old structured `firstLastFramePrompt` and a distinct `videoPrompt`. Assert the generated prompt contains the original video action, does not contain the old bridge body, and contains each structural marker exactly once.

```ts
it('does not recursively wrap an existing first-last-frame prompt', () => {
  const prompt = buildDefaultFirstLastFramePrompt({
    firstPanel: {
      videoPrompt: 'the man raises his eyes toward the light',
      firstLastFramePrompt: 'Start from the first frame: old bridge. Bridge naturally into the last frame: old ending.',
    },
    lastPanel: { videoPrompt: 'the blue figure becomes still' },
  })

  expect(prompt).toContain('the man raises his eyes toward the light')
  expect(prompt).not.toContain('old bridge')
  expect(prompt.match(/Start from the first frame:/g)).toHaveLength(1)
  expect(prompt.match(/Bridge naturally into the last frame:/g)).toHaveLength(1)
})
```

- [ ] **Step 2: Run the focused continuity test and verify RED**

Run: `npx.cmd vitest run tests/unit/novel-promotion/panel-continuity.test.ts`

Expected: FAIL because the old `firstLastFramePrompt` is selected as `firstAction`.

- [ ] **Step 3: Implement the minimal fallback fix**

Change `buildDefaultFirstLastFramePrompt` so `firstAction` uses only:

```ts
const firstAction = compactText(
  pickPanelContinuityActionText(params.firstPanel),
  220,
)
```

Leave the rest of the bridge structure unchanged.

- [ ] **Step 4: Run focused continuity and worker tests and verify GREEN**

Run:

```powershell
npx.cmd vitest run tests/unit/novel-promotion/panel-continuity.test.ts tests/unit/worker/first-last-frame-prompt.test.ts
```

Expected: all tests PASS, including deterministic fallback cases.

- [ ] **Step 5: Commit the fallback fix**

```powershell
git add -- src/lib/novel-promotion/panel-continuity.ts tests/unit/novel-promotion/panel-continuity.test.ts tests/unit/worker/first-last-frame-prompt.test.ts
git commit -m "fix(video): prevent nested transition fallback prompts"
```

### Task 3: Verify the complete user-visible flow

**Files:**
- Test: `tests/unit/novel-promotion/first-last-frame-prompt-entry.test.ts`
- Test: `tests/unit/novel-promotion/panel-continuity.test.ts`
- Test: `tests/unit/worker/first-last-frame-prompt.test.ts`
- Test: `tests/unit/novel-promotion/video-panel-card-body.test.ts`

**Interfaces:**
- Consumes: the two fixes from Tasks 1 and 2.
- Produces: verification evidence only; no new production interface.

- [ ] **Step 1: Run the complete focused regression suite**

```powershell
npx.cmd vitest run tests/unit/novel-promotion/first-last-frame-prompt-entry.test.ts tests/unit/novel-promotion/panel-continuity.test.ts tests/unit/worker/first-last-frame-prompt.test.ts tests/unit/novel-promotion/video-panel-card-body.test.ts
```

Expected: all selected test files PASS with zero failures.

- [ ] **Step 2: Run static validation**

Run: `npm.cmd run typecheck`

If the repository has no `typecheck` script, run `npx.cmd tsc --noEmit` instead.

Expected: exit code 0.

- [ ] **Step 3: Inspect the final diff**

Run:

```powershell
git diff --check HEAD~2..HEAD
git status --short --branch
```

Expected: no whitespace errors and no uncommitted implementation changes.
