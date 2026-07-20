# LTX2.3 KJ No-Subtitles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the KJ LTX2.3 PromptRelay workflow from generating burned-in subtitles or readable dialogue text while preserving visible speaking motion and existing content-aware timing.

**Architecture:** Add a focused KJ positive-prompt sanitizer and invoke it from every KJ enhancement/fallback path. Convert the KJ workflow's existing zeroed negative-conditioning node into a locked `CLIPTextEncode` using the PromptRelay CLIP connection and an application-owned text-artifact negative prompt. Keep every other workflow unchanged.

**Tech Stack:** TypeScript, Vitest, ComfyUI workflow graph injection, existing GPT-5.5 LTX prompt enhancement.

## Global Constraints

- Apply only to `basevideo/ltx23-profiles/t8-multishot-precise-promptrelay-kj-720p`.
- Keep KJ at 720p, 25 fps, existing duration selection, motion-strength control, and model-timed non-equal `LENGTHS`.
- Do not copy the reference workflow's extra Codex node or audio latent stages.
- Do not modify Smart VBVR, Bernini, Goon, Wan, or any other workflow.
- Preserve unrelated dirty worktree changes and stage only files listed in each task.

---

### Task 1: KJ positive-prompt subtitle sanitizer

**Files:**
- Create: `src/lib/video-duration/ltx23-kj-no-subtitles.ts`
- Create: `tests/unit/video/ltx23-kj-no-subtitles.test.ts`

**Interfaces:**
- Consumes: a production-ready KJ structured or unstructured prompt string.
- Produces: `sanitizeLtx23KjNoSubtitlePrompt(value: string): string`.
- Guarantees: speech-introduced quoted transcript is replaced by visible speaking motion; ordinary non-speech quoted labels remain; PromptRelay markers and `LENGTHS` remain unchanged; positive text-artifact prohibition clauses are removed because those concepts belong in negative conditioning.

- [ ] **Step 1: Write failing sanitizer tests**

Cover Chinese and English speech, non-speech quotes, PromptRelay structure, and positive negative-term cleanup:

```ts
import { describe, expect, it } from 'vitest'
import { sanitizeLtx23KjNoSubtitlePrompt } from '@/lib/video-duration/ltx23-kj-no-subtitles'

describe('LTX2.3 KJ no-subtitles prompt sanitizer', () => {
  it('removes Chinese spoken transcript but keeps visible speaking motion', () => {
    const result = sanitizeLtx23KjNoSubtitlePrompt(
      'LOCAL 1: 海商盟代表意志朝右侧开口：“如此条件，未免太重。”并轻轻抬手。',
    )
    expect(result).not.toContain('如此条件')
    expect(result).toContain('嘴唇')
    expect(result).toContain('轻轻抬手')
  })

  it('removes English spoken transcript without deleting ordinary quoted objects', () => {
    const result = sanitizeLtx23KjNoSubtitlePrompt(
      'LOCAL 1: She says "Answer me" and points at the sign named "Gate A".',
    )
    expect(result).not.toContain('Answer me')
    expect(result).toContain('rhythmic visible lip movement')
    expect(result).toContain('"Gate A"')
  })

  it('preserves PromptRelay structure and removes text-artifact prohibition clauses', () => {
    const result = sanitizeLtx23KjNoSubtitlePrompt([
      'GLOBAL: same room.',
      'LOCAL 1: The speaker talks naturally.',
      'LOCAL 2: Continue the hand motion. Do not add subtitles, captions, or readable text.',
      'LOCAL 3: Settle the gesture.',
      'LENGTHS: 50, 130, 45',
    ].join('\n'))
    expect(result).toContain('GLOBAL:')
    expect(result).toContain('LOCAL 1:')
    expect(result).toContain('LENGTHS: 50, 130, 45')
    expect(result.toLowerCase()).not.toContain('subtitles')
  })
})
```

- [ ] **Step 2: Run the new tests and verify RED**

Run:

```powershell
npx.cmd vitest run tests/unit/video/ltx23-kj-no-subtitles.test.ts
```

Expected: FAIL because `ltx23-kj-no-subtitles.ts` does not exist.

- [ ] **Step 3: Implement the minimal focused sanitizer**

Create `src/lib/video-duration/ltx23-kj-no-subtitles.ts` with speech-scoped regex replacements for Chinese curly quotes and English straight/curly quotes. Replace matched transcript with locale-appropriate visible mouth-motion text, then remove only clauses that combine text-artifact terms with negative instructions. Normalize duplicate punctuation and whitespace without changing line breaks or PromptRelay markers.

```ts
const ZH_VISIBLE_SPEAKING = '自然说话，嘴唇有节奏地开合并配合轻微表情与克制手势'
const EN_VISIBLE_SPEAKING = 'speaks naturally with rhythmic visible lip movement, subtle facial motion, and restrained gestures'

export function sanitizeLtx23KjNoSubtitlePrompt(value: string): string {
  // Replace speech-introduced transcript spans only; keep unrelated quoted names.
  // Remove positive clauses such as "Do not add subtitles..." because the
  // locked negative-conditioning node owns those concepts.
  // Preserve GLOBAL/LOCAL/LENGTHS lines and return trimmed text.
}
```

- [ ] **Step 4: Run sanitizer tests and verify GREEN**

Run the Task 1 Vitest command. Expected: all tests PASS.

- [ ] **Step 5: Commit Task 1**

```powershell
git add -- src/lib/video-duration/ltx23-kj-no-subtitles.ts tests/unit/video/ltx23-kj-no-subtitles.test.ts
git commit -m "feat(video): sanitize KJ dialogue text"
```

---

### Task 2: Integrate the sanitizer with GPT-5.5 and fallback paths

**Files:**
- Modify: `src/lib/video-duration/ltx23-prompt-enhance.ts`
- Modify: `tests/unit/video/ltx23-prompt-enhance.test.ts`

**Interfaces:**
- Consumes: `sanitizeLtx23KjNoSubtitlePrompt` from Task 1.
- Produces: every KJ result path returns a sanitized positive prompt; other workflow results remain byte-for-byte governed by their existing paths.

- [ ] **Step 1: Add failing integration tests**

Extend `ltx23-prompt-enhance.test.ts` with:

```ts
it('removes literal Chinese dialogue from a valid GPT-5.5 KJ response', async () => {
  aiRuntimeMock.executeAiTextStep.mockResolvedValueOnce({
    text: JSON.stringify({
      enhanced_prompt: [
        'GLOBAL: 同一交易台与同一人物。',
        'LOCAL 1: 海商盟代表意志开口：“如此条件，未免太重。”并轻轻抬手。',
        'LOCAL 2: 他继续自然说话，嘴唇有节奏地开合。',
        'LOCAL 3: 手势缓慢停下。',
      ].join('\n'),
      segment_frames: [50, 130, 45],
    }),
  })
  const result = await enhanceLtx23VideoPrompt(kjInput({ durationSeconds: 9, fps: 25 }))
  expect(result.prompt).not.toContain('如此条件')
  expect(result.prompt).toContain('嘴唇')
  expect(result.prompt).toContain('LENGTHS: 50, 130, 45')
})
```

Add a second test where Codex throws and `originalPrompt` contains `says "Answer me"`; assert fallback keeps three LOCAL sections and removes `Answer me`. Add an isolation assertion using a non-KJ LTX model whose quoted dialogue remains governed by its existing behavior.

- [ ] **Step 2: Run the prompt-enhancement suite and verify RED**

```powershell
npx.cmd vitest run tests/unit/video/ltx23-prompt-enhance.test.ts
```

Expected: new KJ transcript-removal assertions FAIL.

- [ ] **Step 3: Add KJ-only generation instructions and sanitizer calls**

In `buildKjPromptRelayTimingLines`, append an instruction equivalent to:

```ts
'Do not include literal transcripts, quoted dialogue, subtitles, captions, or readable speech text in enhanced_prompt. Preserve speaking intent only as visible rhythmic lip movement, facial motion, gaze, posture, and restrained gestures. Keep text-artifact prohibitions out of the positive prompt because the workflow supplies locked negative conditioning.'
```

Import the Task 1 sanitizer. In `appendLtx23SafetyConstraints`, sanitize the fully assembled result only when `isComfyUiLtx23KjPromptRelayWorkflow(input.modelKey)` is true. In the KJ fallback builder, sanitize `originalPrompt` before inserting it into `LOCAL 1`. This covers valid GPT output, invalid frames, missing model, user-edited prompts, malformed JSON, and thrown errors through the existing shared paths.

- [ ] **Step 4: Run prompt and sanitizer tests**

```powershell
npx.cmd vitest run tests/unit/video/ltx23-kj-no-subtitles.test.ts tests/unit/video/ltx23-prompt-enhance.test.ts
```

Expected: all tests PASS; existing GPT-5.5 `segment_frames` and fallback tests remain green.

- [ ] **Step 5: Commit Task 2**

```powershell
git add -- src/lib/video-duration/ltx23-prompt-enhance.ts tests/unit/video/ltx23-prompt-enhance.test.ts
git commit -m "feat(video): guard KJ positive prompts from subtitles"
```

---

### Task 3: Convert the KJ zero-negative branch to locked text conditioning

**Files:**
- Modify: `src/lib/providers/comfyui/workflow-registry.ts`
- Modify: `tests/unit/providers/comfyui-workflow-registry.test.ts`

**Interfaces:**
- Consumes: KJ API graph nodes `605` (`PromptRelayEncode` with `clip`) and `420` (`ConditioningZeroOut` sourced from node `605`).
- Produces: node `420` becomes a locked `CLIPTextEncode` whose output remains connected to `164.negative`.
- Throws: `COMFYUI_LTX23_KJ_NO_SUBTITLE_CONDITIONING_INVALID` if the expected KJ graph contract is missing.

- [ ] **Step 1: Write failing workflow tests**

Add a KJ assertion to `comfyui-workflow-registry.test.ts`:

```ts
const workflow = resolveComfyUiWorkflow(COMFYUI_LTX23_WORKFLOW_KEYS.multiShotPromptRelayKj, {
  prompt: 'GLOBAL: room\nLOCAL 1: prepare\nLOCAL 2: speak\nLOCAL 3: settle\nLENGTHS: 50, 130, 45',
  imageFilenames: ['source.png'],
  fps: 25,
  durationSeconds: 9,
  targetFrameCount: 225,
})
expect(workflow['420']?.class_type).toBe('CLIPTextEncode')
expect(workflow['420']?.inputs.clip).toEqual(['416', 0])
expect(String(workflow['420']?.inputs.text).toLowerCase()).toContain('subtitles')
expect(String(workflow['420']?.inputs.text)).toContain('Chinese characters')
expect(workflow['164']?.inputs.negative).toEqual(['420', 0])
expect(workflow['164']?.inputs.positive).toEqual(['605', 1])
```

Resolve `t8-smart-vbvr-390k-v2` without audio and assert its existing negative path is unchanged, proving KJ isolation.

- [ ] **Step 2: Run the registry tests and verify RED**

```powershell
npx.cmd vitest run tests/unit/providers/comfyui-workflow-registry.test.ts
```

Expected: KJ node `420` is still `ConditioningZeroOut`.

- [ ] **Step 3: Implement KJ negative-conditioning conversion**

Add `LTX23_KJ_TEXT_ARTIFACT_NEGATIVE_PROMPT` with focused text-artifact terms. Add `applyLtx23KjTextArtifactNegativeConditioning(graph)` that validates nodes `605` and `420`, clones `605.inputs.clip`, confirms `420.inputs.conditioning` points to `605`, then converts node `420` in place:

```ts
negativeNode.class_type = 'CLIPTextEncode'
negativeNode.inputs = {
  clip: cloneConnectionValue(promptRelayNode.inputs.clip),
  text: LTX23_KJ_TEXT_ARTIFACT_NEGATIVE_PROMPT,
}
negativeNode._meta = {
  ...(isRecord(negativeNode._meta) ? negativeNode._meta : {}),
  title: 'KJ no-subtitles negative prompt',
}
```

Call it only inside the existing KJ branch of `applyLtx23WorkflowProfileControls`, before pruning. Throw the exact contract error when validation fails.

- [ ] **Step 4: Run registry and KJ profile tests**

```powershell
npx.cmd vitest run tests/unit/providers/comfyui-workflow-registry.test.ts tests/unit/providers/comfyui/ltx23-workflow-profiles.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit Task 3**

```powershell
git add -- src/lib/providers/comfyui/workflow-registry.ts tests/unit/providers/comfyui-workflow-registry.test.ts
git commit -m "feat(comfyui): add KJ subtitle-negative conditioning"
```

---

### Task 4: Regression, review, and live 112 verification

**Files:**
- Modify only if a discovered defect requires a focused fix and regression test.

**Interfaces:**
- Consumes: completed Tasks 1-3.
- Produces: verified KJ no-subtitles behavior with a clean task-specific diff and one successful live video.

- [ ] **Step 1: Run focused regression and type checking**

```powershell
npx.cmd vitest run tests/unit/video/ltx23-kj-no-subtitles.test.ts tests/unit/video/ltx23-prompt-enhance.test.ts tests/unit/providers/comfyui-workflow-registry.test.ts tests/unit/providers/comfyui/ltx23-workflow-profiles.test.ts tests/unit/model-capabilities/video-recommended-duration.test.ts tests/unit/model-capabilities/comfyui-video-capabilities.test.ts tests/unit/worker/video-generation-resume.test.ts tests/unit/api-config/comfyui-goon-runtime-helper.test.ts tests/integration/api/specific/user-models-comfyui-legacy-filter.test.ts
npm.cmd run typecheck
git diff --check
```

Expected: every focused test passes, type checking exits 0, and diff check is empty.

- [ ] **Step 2: Request read-only code review**

Review only task commits and check KJ isolation, transcript sanitizer precision, negative-conditioning graph validity, fallback coverage, and preservation of 9-second/720p/model-timed behavior. Fix every blocking issue with a regression test.

- [ ] **Step 3: Run live generation on a speaking panel**

In the project UI, select `ComfyUI · LTX2.3 多镜头精准 PromptRelay 720p` for a panel whose prompt contains visible speaking or dialogue context. Keep its recommended duration, 25 fps, 720p, and an appropriate motion-strength value. Submit to the configured ComfyUI 112 endpoint and wait for completion.

- [ ] **Step 4: Verify live prompt, graph, task, and frames**

Confirm logs show `codex::gpt-5.5`, non-equal `segment_frames`, no literal transcript in the final positive PromptRelay prompt, and the KJ negative node's text-artifact terms. Confirm the task reaches `completed / 100%`. Inspect representative beginning, middle, and ending frames for burned-in subtitle lines or readable dialogue text.

- [ ] **Step 5: Final verification commit if needed**

If review or live testing required changes, commit only those task files with a focused message. Otherwise leave the three implementation commits as the final history.

