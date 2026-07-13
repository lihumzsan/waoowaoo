# First Last Smart Duration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build first/last-frame-only smart duration recommendation so the duration dropdown defaults to the computed recommendation, while manual user choices remain authoritative.

**Architecture:** Reuse the existing first/last-frame prompt worker call to return both the transition prompt and a structured motion analysis. A pure local duration calculator validates that analysis, computes an integer 4-15 second recommendation, persists it in the existing `videoDurationBinding` JSON, and the frontend reads that binding as the default for first/last-frame generation only.

**Tech Stack:** TypeScript, Next.js route handlers, Prisma string JSON field, BullMQ worker, React hooks/components, Vitest.

## Global Constraints

- Only `videoGenerationMode === 'firstlastframe'` may use smart duration.
- The smart recommendation becomes the default value in the existing first/last-frame duration dropdown.
- A user manual dropdown choice writes `durationSource: 'manual'` and permanently wins until the user restores smart recommendation.
- Normal path must not add a second AI request; reuse `handleFirstLastFramePromptTask`.
- Goon first/last-frame duration range is integer seconds 4 through 15, default 10, fps 24.
- Frame count rule is `1 + 8 * round(duration * 24 / 8)`.
- No database migration; extend the existing `videoDurationBinding` text JSON field.
- Smart analysis failure must not block video generation.
- Use `npm.cmd` and `npx.cmd` on Windows.
- Do not overwrite unrelated user changes.

---

## File Structure

- Create `src/lib/novel-promotion/first-last-frame-smart-duration.ts`
  - Owns motion analysis types, parser/normalizer, deterministic calculator, fallback selection, recommendation fingerprint, and public constants.
- Modify `src/lib/video-duration/audio-binding.ts`
  - Extends `VideoDurationBinding` with smart/manual metadata and preserves legacy normalization behavior.
- Modify `src/lib/providers/comfyui/ltx23-workflow-profiles.ts`
  - Expands Goon supported durations to `[4, 5, ..., 15]` and stops falling back valid integer durations to 10.
- Modify `src/lib/providers/comfyui/workflow-registry.ts`
  - Uses the same duration normalization and frame-index helper for Goon workflow injection.
- Modify `standards/capabilities/image-video.catalog.json`
  - Exposes 4-15 integer duration options for the Goon first/last-frame model entry.
- Modify `src/lib/novel-promotion/first-last-frame-prompt-fingerprint.ts`
  - Moves duration fingerprinting to smart/manual binding semantics and adds smart algorithm version to the source signature.
- Modify `src/lib/workers/handlers/first-last-frame-prompt.ts`
  - Parses structured motion analysis from the same AI output, computes recommendation, and persists it into `videoDurationBinding` without overriding manual bindings.
- Modify `src/app/api/novel-promotion/[projectId]/first-last-frame-prompt/route.ts`
  - Returns persisted prompt shortcut with smart duration metadata when it already exists.
- Modify `src/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry.ts`
  - Applies smart default, manual override, restore-smart behavior, and generation option resolution.
- Modify `src/lib/novel-promotion/stages/video-stage-runtime/useFirstLastFramePromptEntries.ts`
  - Carries cached smart duration bindings through prompt task state and panel overrides.
- Modify `src/lib/novel-promotion/stages/video-stage-runtime/useVideoFirstLastFrameFlow.ts`
  - Adds restore-smart action and prevents prompt regeneration from being triggered by manual duration-only selection.
- Modify `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/panel-card/VideoPanelCardBody.tsx`
  - Shows first/last smart recommendation state near the existing dropdown and restore action after manual selection.
- Modify tests:
  - `tests/unit/novel-promotion/first-last-frame-smart-duration.test.ts`
  - `tests/unit/novel-promotion/first-last-frame-prompt-entry.test.ts`
  - `tests/unit/novel-promotion/first-last-frame-prompt-fingerprint-input.test.ts`
  - `tests/unit/worker/first-last-frame-prompt.test.ts`
  - `tests/integration/api/specific/first-last-frame-prompt-route.test.ts`
  - `tests/unit/providers/comfyui/ltx23-workflow-profiles.test.ts`
  - `tests/unit/providers/comfyui/workflow-registry.test.ts`
  - `tests/unit/providers/comfyui/ltx23-workflow-router.test.ts`

### Shared Interfaces

```ts
export const FIRST_LAST_FRAME_SMART_DURATION_ALGORITHM_VERSION = 'v1'
export const FIRST_LAST_FRAME_SMART_DURATION_CONFIDENCE_THRESHOLD = 0.6
export const FIRST_LAST_FRAME_SMART_DURATION_MIN_SECONDS = 4
export const FIRST_LAST_FRAME_SMART_DURATION_MAX_SECONDS = 15
export const FIRST_LAST_FRAME_SMART_DURATION_DEFAULT_SECONDS = 10
export const FIRST_LAST_FRAME_SMART_DURATION_FPS = 24

export type FirstLastFrameMotionBeatType =
  | 'micro_motion'
  | 'gesture'
  | 'body_action'
  | 'locomotion'
  | 'environment_change'
  | 'transformation'
  | 'camera_standard'
  | 'camera_large'

export type FirstLastFrameMotionBeat = {
  type: FirstLastFrameMotionBeatType
  order: number
  parallelGroup?: string
}

export type FirstLastFrameDurationAnalysis = {
  motionBeats: FirstLastFrameMotionBeat[]
  pacing: 'fast' | 'normal' | 'slow'
  continuity: 'good' | 'challenging' | 'discontinuous'
  confidence: number
  reason: string
}

export type FirstLastFrameSmartDurationRecommendation = {
  durationSeconds: number
  frameCount: number
  fps: number
  confidence: number
  reason: string
  fingerprint: string
  continuity: FirstLastFrameDurationAnalysis['continuity']
  source: 'smart' | 'fallback'
  fallbackReason?: 'invalid_analysis' | 'low_confidence' | 'discontinuous'
}
```

---

### Task 1: Goon Duration Range and Frame Helpers

**Files:**
- Modify: `src/lib/providers/comfyui/ltx23-workflow-profiles.ts`
- Modify: `src/lib/providers/comfyui/workflow-registry.ts`
- Modify: `standards/capabilities/image-video.catalog.json`
- Test: `tests/unit/providers/comfyui/ltx23-workflow-profiles.test.ts`
- Test: `tests/unit/providers/comfyui/workflow-registry.test.ts`
- Test: `tests/unit/providers/comfyui/ltx23-workflow-router.test.ts`

**Interfaces:**
- Produces: `COMFYUI_LTX23_GOON_DURATION_OPTIONS` as readonly `[4,5,6,7,8,9,10,11,12,13,14,15]`.
- Produces: `normalizeLtx23GoonDurationSeconds(raw: unknown): number`, accepting only finite integer values from 4 to 15.
- Produces: `resolveLtx23GoonFrameCount(durationSeconds: number): number`, returning `1 + 8 * Math.round(durationSeconds * 24 / 8)`.
- Produces: `resolveLtx23GoonFinalFrameIndex(durationSeconds: number): number`, returning `resolveLtx23GoonFrameCount(durationSeconds) - 1`.

- [ ] **Step 1: Write failing profile tests**

Add these expectations to `tests/unit/providers/comfyui/ltx23-workflow-profiles.test.ts`:

```ts
import {
  COMFYUI_LTX23_WORKFLOW_KEYS,
  getLtx23WorkflowProfile,
  normalizeLtx23GoonDurationSeconds,
  resolveLtx23GoonFrameCount,
  resolveLtx23GoonFinalFrameIndex,
} from '@/lib/providers/comfyui/ltx23-workflow-profiles'

it('registers Goon first-last-frame durations from 4 through 15 seconds', () => {
  expect(getLtx23WorkflowProfile(COMFYUI_LTX23_WORKFLOW_KEYS.goonFirstLastFrame)).toMatchObject({
    maxDurationSeconds: 15,
    defaultDurationSeconds: 10,
    durationOptions: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    fps: 24,
  })
})

it.each([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])(
  'accepts %s seconds for Goon first-last-frame normalization',
  (duration) => {
    expect(normalizeLtx23GoonDurationSeconds(duration)).toBe(duration)
  },
)

it.each([
  [3, 10],
  [15.5, 10],
  [16, 10],
  ['8', 10],
  [Number.NaN, 10],
])('falls invalid Goon duration %j back to default %s', (input, expected) => {
  expect(normalizeLtx23GoonDurationSeconds(input)).toBe(expected)
})

it.each([
  [4, 97],
  [8, 193],
  [10, 241],
  [15, 361],
])('computes the Goon 8n+1 frame count for %ss', (duration, frameCount) => {
  expect(resolveLtx23GoonFrameCount(duration)).toBe(frameCount)
  expect(resolveLtx23GoonFinalFrameIndex(duration)).toBe(frameCount - 1)
})
```

- [ ] **Step 2: Run profile tests and verify failure**

Run:

```powershell
npx.cmd vitest run tests/unit/providers/comfyui/ltx23-workflow-profiles.test.ts
```

Expected: FAIL because duration 7/9/11/13/14/15 are not accepted and frame helper exports do not exist.

- [ ] **Step 3: Implement profile constants and helpers**

Update `src/lib/providers/comfyui/ltx23-workflow-profiles.ts`:

```ts
export const COMFYUI_LTX23_GOON_DURATION_OPTIONS = [
  4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
] as const
export const COMFYUI_LTX23_GOON_DEFAULT_DURATION_SECONDS = 10
export const COMFYUI_LTX23_GOON_FPS = 24

export function resolveLtx23GoonFrameCount(durationSeconds: number): number {
  const normalized = normalizeLtx23GoonDurationSeconds(durationSeconds)
  return 1 + 8 * Math.round((normalized * COMFYUI_LTX23_GOON_FPS) / 8)
}

export function resolveLtx23GoonFinalFrameIndex(durationSeconds: number): number {
  return resolveLtx23GoonFrameCount(durationSeconds) - 1
}

export function normalizeLtx23GoonDurationSeconds(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw)) {
    return COMFYUI_LTX23_GOON_DEFAULT_DURATION_SECONDS
  }
  return COMFYUI_LTX23_GOON_DURATION_OPTIONS.includes(
    raw as typeof COMFYUI_LTX23_GOON_DURATION_OPTIONS[number],
  )
    ? raw
    : COMFYUI_LTX23_GOON_DEFAULT_DURATION_SECONDS
}
```

Also set the Goon profile `maxDurationSeconds` to 15 and keep `durationOptions: [...COMFYUI_LTX23_GOON_DURATION_OPTIONS]`.

- [ ] **Step 4: Update workflow registry to use helper**

In `src/lib/providers/comfyui/workflow-registry.ts`, import `resolveLtx23GoonFinalFrameIndex` and replace the inline frame-index computation:

```ts
const finalPixelFrameIndex = resolveLtx23GoonFinalFrameIndex(durationSeconds)
```

- [ ] **Step 5: Update capability catalog**

In `standards/capabilities/image-video.catalog.json`, update the Goon first/last-frame model entry with `modelId` `basevideo/ltx23-profiles/goon-first-last-frame-2stage` so its `durationOptions` are:

```json
[4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
```

Leave unrelated model entries unchanged.

- [ ] **Step 6: Run Task 1 tests**

Run:

```powershell
npx.cmd vitest run tests/unit/providers/comfyui/ltx23-workflow-profiles.test.ts tests/unit/providers/comfyui/workflow-registry.test.ts tests/unit/providers/comfyui/ltx23-workflow-router.test.ts
```

Expected: PASS. Router tests must confirm first/last-frame requested durations 7 and 15 route to Goon without fallback to 10, while normal-mode routing behavior remains unchanged.

- [ ] **Step 7: Commit Task 1**

```powershell
git add src/lib/providers/comfyui/ltx23-workflow-profiles.ts src/lib/providers/comfyui/workflow-registry.ts standards/capabilities/image-video.catalog.json tests/unit/providers/comfyui/ltx23-workflow-profiles.test.ts tests/unit/providers/comfyui/workflow-registry.test.ts tests/unit/providers/comfyui/ltx23-workflow-router.test.ts
git commit -m "feat: expand goon first-last duration range"
```

---

### Task 2: Smart Duration Pure Module

**Files:**
- Create: `src/lib/novel-promotion/first-last-frame-smart-duration.ts`
- Test: `tests/unit/novel-promotion/first-last-frame-smart-duration.test.ts`

**Interfaces:**
- Consumes: `normalizeLtx23GoonDurationSeconds`, `resolveLtx23GoonFrameCount`, `COMFYUI_LTX23_GOON_FPS`.
- Produces: types and constants from the Shared Interfaces section.
- Produces: `parseFirstLastFrameDurationAnalysis(raw: unknown): FirstLastFrameDurationAnalysis | null`.
- Produces: `computeFirstLastFrameSmartDuration(params): FirstLastFrameSmartDurationRecommendation`.
- Produces: `buildFirstLastFrameSmartDurationFingerprint(input: unknown): string`.
- Produces: `resolveFirstLastFrameSmartDurationBinding(params): VideoDurationBinding`.

- [ ] **Step 1: Write failing calculator tests**

Create `tests/unit/novel-promotion/first-last-frame-smart-duration.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  buildFirstLastFrameSmartDurationFingerprint,
  computeFirstLastFrameSmartDuration,
  parseFirstLastFrameDurationAnalysis,
} from '@/lib/novel-promotion/first-last-frame-smart-duration'

describe('first/last-frame smart duration', () => {
  it('adds serial stages and takes the max duration inside a parallel group', () => {
    const result = computeFirstLastFrameSmartDuration({
      analysis: {
        motionBeats: [
          { type: 'body_action', order: 1 },
          { type: 'locomotion', order: 2, parallelGroup: 'move' },
          { type: 'environment_change', order: 2, parallelGroup: 'move' },
          { type: 'camera_standard', order: 2, parallelGroup: 'move' },
        ],
        pacing: 'normal',
        continuity: 'good',
        confidence: 0.9,
        reason: '包含转身和位置移动，镜头缓慢推进',
      },
      fingerprint: 'fingerprint-1',
    })

    expect(result).toMatchObject({
      durationSeconds: 8,
      frameCount: 193,
      fps: 24,
      source: 'smart',
      confidence: 0.9,
    })
  })

  it.each([
    ['fast', 7],
    ['normal', 8],
    ['slow', 9],
  ] as const)('applies %s pacing', (pacing, expectedDuration) => {
    const result = computeFirstLastFrameSmartDuration({
      analysis: {
        motionBeats: [
          { type: 'body_action', order: 1 },
          { type: 'locomotion', order: 2 },
        ],
        pacing,
        continuity: 'good',
        confidence: 0.8,
        reason: '动作清晰',
      },
      fingerprint: 'fingerprint-pace',
    })

    expect(result.durationSeconds).toBe(expectedDuration)
  })

  it('never recommends shorter than the audio target', () => {
    const result = computeFirstLastFrameSmartDuration({
      analysis: {
        motionBeats: [{ type: 'gesture', order: 1 }],
        pacing: 'normal',
        continuity: 'good',
        confidence: 0.8,
        reason: '轻微手势',
      },
      fingerprint: 'fingerprint-audio',
      audioTargetDurationSeconds: 12,
    })

    expect(result.durationSeconds).toBe(12)
  })

  it.each([
    ['empty motion clamps to min', [], 4],
    ['long serial motion clamps to max', Array.from({ length: 8 }, (_, index) => ({ type: 'transformation' as const, order: index + 1 })), 15],
  ])('%s', (_label, motionBeats, expectedDuration) => {
    const result = computeFirstLastFrameSmartDuration({
      analysis: {
        motionBeats,
        pacing: 'normal',
        continuity: 'good',
        confidence: 0.95,
        reason: '测试边界',
      },
      fingerprint: 'fingerprint-boundary',
    })

    expect(result.durationSeconds).toBe(expectedDuration)
  })

  it('falls back to 10s for low confidence and discontinuous continuity', () => {
    const lowConfidence = computeFirstLastFrameSmartDuration({
      analysis: {
        motionBeats: [{ type: 'locomotion', order: 1 }],
        pacing: 'normal',
        continuity: 'good',
        confidence: 0.59,
        reason: '置信度不足',
      },
      fingerprint: 'low-confidence',
    })
    const discontinuous = computeFirstLastFrameSmartDuration({
      analysis: {
        motionBeats: [{ type: 'locomotion', order: 1 }],
        pacing: 'normal',
        continuity: 'discontinuous',
        confidence: 0.9,
        reason: '首尾画面变化较大，建议增加中间关键帧',
      },
      fingerprint: 'discontinuous',
    })

    expect(lowConfidence).toMatchObject({ durationSeconds: 10, source: 'fallback', fallbackReason: 'low_confidence' })
    expect(discontinuous).toMatchObject({ durationSeconds: 10, source: 'fallback', fallbackReason: 'discontinuous' })
  })

  it('rejects invalid structured analysis', () => {
    expect(parseFirstLastFrameDurationAnalysis({
      motion_beats: [{ type: 'unknown', order: 1 }],
      pacing: 'normal',
      continuity: 'good',
      confidence: 0.9,
      reason: 'invalid',
    })).toBeNull()
    expect(parseFirstLastFrameDurationAnalysis({
      motion_beats: [{ type: 'gesture', order: 1 }],
      pacing: 'normal',
      continuity: 'good',
      confidence: 1.2,
      reason: 'invalid',
    })).toBeNull()
  })

  it('accepts snake_case AI output and returns camelCase analysis', () => {
    expect(parseFirstLastFrameDurationAnalysis({
      motion_beats: [{ type: 'gesture', order: 1, parallel_group: 'hands' }],
      pacing: 'normal',
      continuity: 'challenging',
      confidence: 0.7,
      reason: '动作较清晰',
    })).toEqual({
      motionBeats: [{ type: 'gesture', order: 1, parallelGroup: 'hands' }],
      pacing: 'normal',
      continuity: 'challenging',
      confidence: 0.7,
      reason: '动作较清晰',
    })
  })

  it('builds a stable fingerprint from canonical input', () => {
    expect(buildFirstLastFrameSmartDurationFingerprint({
      firstPanelId: 'a',
      lastPanelId: 'b',
      audio: [{ id: 'voice-1', durationMs: 1300 }],
    })).toBe(buildFirstLastFrameSmartDurationFingerprint({
      lastPanelId: 'b',
      audio: [{ durationMs: 1300, id: 'voice-1' }],
      firstPanelId: 'a',
    }))
  })
})
```

- [ ] **Step 2: Run calculator tests and verify failure**

Run:

```powershell
npx.cmd vitest run tests/unit/novel-promotion/first-last-frame-smart-duration.test.ts
```

Expected: FAIL because `first-last-frame-smart-duration.ts` does not exist.

- [ ] **Step 3: Implement pure module**

Create `src/lib/novel-promotion/first-last-frame-smart-duration.ts` with:

```ts
import { sha256Hex } from '@/lib/media/hash'
import {
  COMFYUI_LTX23_GOON_DEFAULT_DURATION_SECONDS,
  COMFYUI_LTX23_GOON_FPS,
  normalizeLtx23GoonDurationSeconds,
  resolveLtx23GoonFrameCount,
} from '@/lib/providers/comfyui/ltx23-workflow-profiles'
import type { VideoDurationBinding } from '@/lib/video-duration/audio-binding'

export const FIRST_LAST_FRAME_SMART_DURATION_ALGORITHM_VERSION = 'v1'
export const FIRST_LAST_FRAME_SMART_DURATION_CONFIDENCE_THRESHOLD = 0.6
export const FIRST_LAST_FRAME_SMART_DURATION_MIN_SECONDS = 4
export const FIRST_LAST_FRAME_SMART_DURATION_MAX_SECONDS = 15
export const FIRST_LAST_FRAME_SMART_DURATION_DEFAULT_SECONDS = COMFYUI_LTX23_GOON_DEFAULT_DURATION_SECONDS
export const FIRST_LAST_FRAME_SMART_DURATION_FPS = COMFYUI_LTX23_GOON_FPS

const MAX_MOTION_BEATS = 12
const MAX_REASON_LENGTH = 80
const LEAD_IN_SECONDS = 0.5
const TAIL_HOLD_SECONDS = 0.75

const BEAT_SECONDS = {
  micro_motion: 1,
  gesture: 2,
  body_action: 3,
  locomotion: 4,
  environment_change: 3,
  transformation: 4,
  camera_standard: 2,
  camera_large: 3,
} as const

const PACE_MULTIPLIER = {
  fast: 0.85,
  normal: 1,
  slow: 1.15,
} as const
```

Then add the exported types from Shared Interfaces, `isRecord`, stable JSON sorting, `parseFirstLastFrameDurationAnalysis`, `computeFirstLastFrameSmartDuration`, and `resolveFirstLastFrameSmartDurationBinding`.

The calculator body must use this shape:

```ts
const stages = new Map<number, Map<string, number>>()
for (const beat of analysis.motionBeats) {
  const stage = stages.get(beat.order) ?? new Map<string, number>()
  const key = beat.parallelGroup || `${beat.order}:${beat.type}:${stage.size}`
  stage.set(key, Math.max(stage.get(key) ?? 0, BEAT_SECONDS[beat.type]))
  stages.set(beat.order, stage)
}
const motionSeconds = Array.from(stages.keys())
  .sort((left, right) => left - right)
  .reduce((sum, order) => {
    const stage = stages.get(order)
    return sum + Math.max(0, ...Array.from(stage?.values() ?? []))
  }, 0)
const paced = (motionSeconds + LEAD_IN_SECONDS + TAIL_HOLD_SECONDS) * PACE_MULTIPLIER[analysis.pacing]
const withAudio = Math.max(paced, audioTargetDurationSeconds ?? 0)
const rounded = Math.round(withAudio)
const clamped = Math.min(
  FIRST_LAST_FRAME_SMART_DURATION_MAX_SECONDS,
  Math.max(FIRST_LAST_FRAME_SMART_DURATION_MIN_SECONDS, rounded),
)
const durationSeconds = normalizeLtx23GoonDurationSeconds(clamped)
```

Fallback rules:

```ts
if (analysis.continuity === 'discontinuous') {
  return fallback('discontinuous', analysis.reason || '首尾画面变化较大，建议增加中间关键帧')
}
if (analysis.confidence < FIRST_LAST_FRAME_SMART_DURATION_CONFIDENCE_THRESHOLD) {
  return fallback('low_confidence', '智能分析置信度不足，当前使用默认 10 秒')
}
```

- [ ] **Step 4: Run Task 2 tests**

Run:

```powershell
npx.cmd vitest run tests/unit/novel-promotion/first-last-frame-smart-duration.test.ts
```

Expected: PASS and local calculator assertions complete in normal Vitest runtime.

- [ ] **Step 5: Commit Task 2**

```powershell
git add src/lib/novel-promotion/first-last-frame-smart-duration.ts tests/unit/novel-promotion/first-last-frame-smart-duration.test.ts
git commit -m "feat: add first-last smart duration calculator"
```

---

### Task 3: Duration Binding Semantics and Prompt Entry Selection

**Files:**
- Modify: `src/lib/video-duration/audio-binding.ts`
- Modify: `src/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry.ts`
- Modify: `src/lib/novel-promotion/first-last-frame-prompt-fingerprint.ts`
- Test: `tests/unit/video/audio-binding.test.ts`
- Test: `tests/unit/novel-promotion/first-last-frame-prompt-entry.test.ts`
- Test: `tests/unit/novel-promotion/first-last-frame-prompt-fingerprint-input.test.ts`

**Interfaces:**
- Consumes: Task 2 smart duration types.
- Produces: `VideoDurationSource = 'smart' | 'manual'`.
- Extends `VideoDurationBinding` with `durationSource`, `recommendationConfidence`, `recommendationReason`, `recommendationFingerprint`, `recommendationAlgorithmVersion`.
- Produces: `isManualFirstLastFrameDurationBinding(binding: VideoDurationBinding): boolean`.
- Produces: `resolveFirstLastFrameDurationSelection(...)` returning manual source.
- Produces: `resolveFirstLastFrameSmartDefault(...)` returning duration/generation options for smart source.

- [ ] **Step 1: Write failing binding tests**

Add to `tests/unit/video/audio-binding.test.ts`:

```ts
it('normalizes smart duration metadata without dropping legacy fields', () => {
  expect(normalizeVideoDurationBinding({
    mode: 'manual',
    voiceLineIds: ['a', 'a', ''],
    targetDurationSeconds: 8,
    durationSource: 'smart',
    recommendationConfidence: 0.82,
    recommendationReason: '包含转身和位置移动',
    recommendationFingerprint: 'fp-1',
    recommendationAlgorithmVersion: 'v1',
  })).toEqual({
    mode: 'manual',
    voiceLineIds: ['a'],
    targetDurationSeconds: 8,
    durationSource: 'smart',
    recommendationConfidence: 0.82,
    recommendationReason: '包含转身和位置移动',
    recommendationFingerprint: 'fp-1',
    recommendationAlgorithmVersion: 'v1',
  })
})

it('treats legacy manual target as manual source', () => {
  expect(normalizeVideoDurationBinding({
    mode: 'manual',
    targetDurationSeconds: 6,
  })).toMatchObject({
    mode: 'manual',
    targetDurationSeconds: 6,
    durationSource: 'manual',
  })
})

it('does not invent manual source for empty legacy manual binding', () => {
  expect(normalizeVideoDurationBinding({ mode: 'manual' })).toEqual({
    mode: 'manual',
    voiceLineIds: [],
  })
})
```

- [ ] **Step 2: Write failing prompt-entry tests**

Update `tests/unit/novel-promotion/first-last-frame-prompt-entry.test.ts`:

```ts
it('persists every supported first-last-frame duration as a manual override', async () => {
  const { resolveFirstLastFrameDurationSelection } = await import(
    '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
  )

  for (const duration of [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
    expect(resolveFirstLastFrameDurationSelection('duration', String(duration), { fps: 24 })).toEqual({
      binding: {
        mode: 'manual',
        voiceLineIds: [],
        targetDurationSeconds: duration,
        durationSource: 'manual',
      },
      generationOptions: { duration, fps: 24 },
    })
  }
})

it('uses smart recommendation as default unless a manual binding exists', async () => {
  const { resolvePanelFirstLastFrameGenerationOptions } = await import(
    '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
  )
  const defaults = { duration: 10, fps: 24 }
  const overrides = new Map<string, typeof defaults>()

  expect(resolvePanelFirstLastFrameGenerationOptions(
    'panel-a',
    defaults,
    overrides,
    {
      mode: 'manual',
      targetDurationSeconds: 8,
      durationSource: 'smart',
      recommendationFingerprint: 'fp-1',
    },
  )).toEqual({ duration: 8, fps: 24 })
  expect(resolvePanelFirstLastFrameGenerationOptions(
    'panel-a',
    defaults,
    overrides,
    {
      mode: 'manual',
      targetDurationSeconds: 6,
      durationSource: 'manual',
      recommendationFingerprint: 'fp-1',
    },
  )).toEqual({ duration: 6, fps: 24 })
})
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```powershell
npx.cmd vitest run tests/unit/video/audio-binding.test.ts tests/unit/novel-promotion/first-last-frame-prompt-entry.test.ts tests/unit/novel-promotion/first-last-frame-prompt-fingerprint-input.test.ts
```

Expected: FAIL on missing metadata normalization, 7/9/11/13/14/15 selection, and old helper signature.

- [ ] **Step 4: Extend `VideoDurationBinding` normalization**

In `src/lib/video-duration/audio-binding.ts`, update the type:

```ts
export type VideoDurationSource = 'smart' | 'manual'

export type VideoDurationBinding = {
  mode?: VideoDurationMode
  voiceLineIds?: string[]
  targetDurationSeconds?: number | null
  durationSource?: VideoDurationSource
  recommendationConfidence?: number
  recommendationReason?: string
  recommendationFingerprint?: string
  recommendationAlgorithmVersion?: string
}
```

Add normalizers:

```ts
function normalizeDurationSource(value: unknown): VideoDurationSource | undefined {
  return value === 'smart' || value === 'manual' ? value : undefined
}

function normalizeConfidence(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  if (value < 0 || value > 1) return undefined
  return Number(value.toFixed(2))
}

function normalizeShortString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLength) : undefined
}
```

In `normalizeVideoDurationBinding`, preserve valid metadata and apply legacy manual compatibility:

```ts
const explicitSource = normalizeDurationSource(value.durationSource)
const durationSource = explicitSource
  ?? (mode === 'manual' && targetDurationSeconds !== null ? 'manual' : undefined)
return {
  mode,
  voiceLineIds: normalizeVoiceLineIds(value.voiceLineIds),
  ...(targetDurationSeconds !== null ? { targetDurationSeconds } : {}),
  ...(durationSource ? { durationSource } : {}),
  ...(normalizeConfidence(value.recommendationConfidence) !== undefined ? { recommendationConfidence: normalizeConfidence(value.recommendationConfidence) } : {}),
  ...(normalizeShortString(value.recommendationReason, 120) ? { recommendationReason: normalizeShortString(value.recommendationReason, 120) } : {}),
  ...(normalizeShortString(value.recommendationFingerprint, 128) ? { recommendationFingerprint: normalizeShortString(value.recommendationFingerprint, 128) } : {}),
  ...(normalizeShortString(value.recommendationAlgorithmVersion, 32) ? { recommendationAlgorithmVersion: normalizeShortString(value.recommendationAlgorithmVersion, 32) } : {}),
}
```

- [ ] **Step 5: Update prompt entry helpers**

In `src/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry.ts`, replace local `GOON_DURATIONS` with imported Goon duration options. Make manual selection:

```ts
binding: {
  mode: 'manual' as const,
  voiceLineIds: [],
  targetDurationSeconds: duration,
  durationSource: 'manual' as const,
}
```

Update `resolvePanelFirstLastFrameGenerationOptions` to accept `persistedBinding?: VideoDurationBinding | number | null`. If a binding has a valid `targetDurationSeconds`, return `{ ...defaults, duration: targetDurationSeconds }` regardless of smart/manual; manual priority is enforced before writes, not by hiding the value during read.

- [ ] **Step 6: Update fingerprint duration semantics**

In `src/lib/novel-promotion/first-last-frame-prompt-fingerprint.ts`, include:

```ts
import { FIRST_LAST_FRAME_SMART_DURATION_ALGORITHM_VERSION } from './first-last-frame-smart-duration'
```

When building fingerprint input, add:

```ts
smartDurationAlgorithmVersion: FIRST_LAST_FRAME_SMART_DURATION_ALGORITHM_VERSION,
durationSource: parsed.durationSource ?? null,
durationSeconds: effectiveDuration(params.firstPanel),
```

For `effectiveDuration`, keep manual and smart `targetDurationSeconds`; invalid or missing bindings fall back to Goon default.

- [ ] **Step 7: Run Task 3 tests**

Run:

```powershell
npx.cmd vitest run tests/unit/video/audio-binding.test.ts tests/unit/novel-promotion/first-last-frame-prompt-entry.test.ts tests/unit/novel-promotion/first-last-frame-prompt-fingerprint-input.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```powershell
git add src/lib/video-duration/audio-binding.ts src/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry.ts src/lib/novel-promotion/first-last-frame-prompt-fingerprint.ts tests/unit/video/audio-binding.test.ts tests/unit/novel-promotion/first-last-frame-prompt-entry.test.ts tests/unit/novel-promotion/first-last-frame-prompt-fingerprint-input.test.ts
git commit -m "feat: persist first-last duration source metadata"
```

---

### Task 4: Worker and API Smart Recommendation Persistence

**Files:**
- Modify: `src/lib/workers/handlers/first-last-frame-prompt.ts`
- Modify: `src/app/api/novel-promotion/[projectId]/first-last-frame-prompt/route.ts`
- Test: `tests/unit/worker/first-last-frame-prompt.test.ts`
- Test: `tests/integration/api/specific/first-last-frame-prompt-route.test.ts`

**Interfaces:**
- Consumes: `parseFirstLastFrameDurationAnalysis`, `computeFirstLastFrameSmartDuration`, `buildFirstLastFrameSmartDurationFingerprint`.
- Produces worker result shape:

```ts
export type GenerateFirstLastFramePromptResult = {
  prompt: string
  sourceFingerprint: string
  applied: boolean
  fallbackUsed: boolean
  warnings: string[]
  smartDuration?: {
    durationSeconds: number
    frameCount: number
    fps: number
    confidence: number
    reason: string
    fingerprint: string
    source: 'smart' | 'fallback'
    fallbackReason?: 'invalid_analysis' | 'low_confidence' | 'discontinuous'
  }
}
```

- [ ] **Step 1: Write failing worker tests**

Add to `tests/unit/worker/first-last-frame-prompt.test.ts`:

```ts
it('parses duration analysis from the same vision call and persists smart binding', async () => {
  aiMock.executeAiVisionStep.mockResolvedValueOnce({
    text: JSON.stringify({
      transition_prompt: validPrompt,
      duration_analysis: {
        motion_beats: [
          { type: 'body_action', order: 1 },
          { type: 'locomotion', order: 2, parallel_group: 'move' },
          { type: 'camera_standard', order: 2, parallel_group: 'move' },
        ],
        pacing: 'normal',
        continuity: 'good',
        confidence: 0.9,
        reason: '包含转身和位置移动，镜头缓慢推进',
      },
      warnings: [],
    }),
  })

  const result = await handleFirstLastFramePromptTask(job())

  expect(aiMock.executeAiVisionStep).toHaveBeenCalledTimes(1)
  expect(transactionPanelMock.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      videoDurationBinding: expect.stringContaining('"durationSource":"smart"'),
    }),
  }))
  expect(result.smartDuration).toMatchObject({
    durationSeconds: 8,
    frameCount: 193,
    fps: 24,
    confidence: 0.9,
    source: 'smart',
  })
})

it('does not overwrite an existing manual duration binding with smart analysis', async () => {
  loadPanelsMock.mockResolvedValue(context(framePanel('panel-1', 0, {
    videoDurationBinding: JSON.stringify({
      mode: 'manual',
      targetDurationSeconds: 6,
      durationSource: 'manual',
    }),
  })))
  aiMock.executeAiVisionStep.mockResolvedValueOnce({
    text: JSON.stringify({
      transition_prompt: validPrompt,
      duration_analysis: {
        motion_beats: [{ type: 'locomotion', order: 1 }],
        pacing: 'slow',
        continuity: 'good',
        confidence: 0.9,
        reason: '大幅移动',
      },
    }),
  })

  const result = await handleFirstLastFramePromptTask(job())

  expect(transactionPanelMock.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      videoDurationBinding: JSON.stringify({
        mode: 'manual',
        voiceLineIds: [],
        targetDurationSeconds: 6,
        durationSource: 'manual',
      }),
    }),
  }))
  expect(result.smartDuration?.durationSeconds).toBeGreaterThanOrEqual(6)
})

it('falls back to 10s smart metadata when duration analysis is invalid but keeps prompt generation successful', async () => {
  aiMock.executeAiVisionStep.mockResolvedValueOnce({
    text: JSON.stringify({
      transition_prompt: validPrompt,
      duration_analysis: { motion_beats: [{ type: 'unknown', order: 1 }] },
    }),
  })

  const result = await handleFirstLastFramePromptTask(job())

  expect(result.fallbackUsed).toBe(false)
  expect(result.smartDuration).toMatchObject({
    durationSeconds: 10,
    source: 'fallback',
    fallbackReason: 'invalid_analysis',
  })
})
```

- [ ] **Step 2: Write failing route shortcut test**

Add to `tests/integration/api/specific/first-last-frame-prompt-route.test.ts`:

```ts
it('returns persisted smart duration metadata with a matching prompt shortcut', async () => {
  validateMock.mockResolvedValueOnce({
    firstPanel: {
      id: 'panel-1',
      firstLastFramePrompt: 'Persisted transition',
      firstLastFramePromptSourceFingerprint: 'fingerprint-current',
      videoDurationBinding: JSON.stringify({
        mode: 'manual',
        targetDurationSeconds: 8,
        durationSource: 'smart',
        recommendationConfidence: 0.88,
        recommendationReason: '包含移动和镜头推进',
        recommendationFingerprint: 'smart-fp',
      }),
    },
    lastPanel: { id: 'panel-2' },
    episodeId: 'episode-1',
  })

  const response = await callRoute(POST, 'POST', {
    firstPanelId: 'panel-1',
    lastPanelId: 'panel-2',
    reason: 'source_change',
  }, { params: { projectId: 'project-1' } })

  await expect(response.json()).resolves.toMatchObject({
    prompt: 'Persisted transition',
    smartDuration: {
      durationSeconds: 8,
      confidence: 0.88,
      reason: '包含移动和镜头推进',
      fingerprint: 'smart-fp',
      source: 'smart',
    },
  })
  expect(maybeSubmitLLMTaskMock).not.toHaveBeenCalled()
})
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```powershell
npx.cmd vitest run tests/unit/worker/first-last-frame-prompt.test.ts tests/integration/api/specific/first-last-frame-prompt-route.test.ts
```

Expected: FAIL because worker does not parse `duration_analysis`, does not persist binding, and route shortcut omits smart metadata.

- [ ] **Step 4: Update prompt parser**

In `src/lib/workers/handlers/first-last-frame-prompt.ts`, change `parseModelOutput` return type to:

```ts
function parseModelOutput(
  text: string,
  sourceContext: string,
): { prompt: string; warnings: string[]; durationAnalysis: FirstLastFrameDurationAnalysis | null } | null
```

Parse both `duration_analysis` and `durationAnalysis`:

```ts
const durationAnalysis = parseFirstLastFrameDurationAnalysis(
  parsed.duration_analysis ?? parsed.durationAnalysis,
)
return { prompt, warnings, durationAnalysis }
```

Keep prompt validation unchanged. If prompt is invalid, the deterministic bridge is used and smart duration falls back with `invalid_analysis`.

- [ ] **Step 5: Compute recommendation and persist binding**

After `sourceFingerprint`, build a smart fingerprint:

```ts
const smartDurationFingerprint = buildFirstLastFrameSmartDurationFingerprint({
  sourceFingerprint,
  workflowKey: timing.workflowKey,
  fps: timing.fps,
  algorithmVersion: FIRST_LAST_FRAME_SMART_DURATION_ALGORITHM_VERSION,
})
```

After prompt generation:

```ts
const smartDuration = generated?.durationAnalysis
  ? computeFirstLastFrameSmartDuration({
      analysis: generated.durationAnalysis,
      fingerprint: smartDurationFingerprint,
    })
  : computeFirstLastFrameSmartDuration({
      analysis: null,
      fingerprint: smartDurationFingerprint,
      fallbackReason: 'invalid_analysis',
    })
```

When persisting, parse latest `videoDurationBinding`. If it is manual, preserve target duration and source. Otherwise write a smart binding:

```ts
const latestBinding = parseVideoDurationBinding(latest.firstPanel.videoDurationBinding)
const nextBinding = latestBinding.durationSource === 'manual'
  ? latestBinding
  : {
      mode: 'manual' as const,
      voiceLineIds: latestBinding.voiceLineIds ?? [],
      targetDurationSeconds: smartDuration.durationSeconds,
      durationSource: 'smart' as const,
      recommendationConfidence: smartDuration.confidence,
      recommendationReason: smartDuration.reason,
      recommendationFingerprint: smartDuration.fingerprint,
      recommendationAlgorithmVersion: FIRST_LAST_FRAME_SMART_DURATION_ALGORITHM_VERSION,
    }
```

Set:

```ts
videoDurationBinding: JSON.stringify(nextBinding)
```

inside the existing `updateMany` data.

- [ ] **Step 6: Update route shortcut**

In `src/app/api/novel-promotion/[projectId]/first-last-frame-prompt/route.ts`, include `videoDurationBinding` in the test mock type and real shortcut response. Use `parseVideoDurationBinding` to return:

```ts
smartDuration: binding.durationSource === 'smart' && binding.targetDurationSeconds
  ? {
      durationSeconds: binding.targetDurationSeconds,
      frameCount: resolveLtx23GoonFrameCount(binding.targetDurationSeconds),
      fps: COMFYUI_LTX23_GOON_FPS,
      confidence: binding.recommendationConfidence ?? 0,
      reason: binding.recommendationReason || '智能推荐时长',
      fingerprint: binding.recommendationFingerprint || sourceFingerprint,
      source: 'smart',
    }
  : undefined
```

- [ ] **Step 7: Run Task 4 tests**

Run:

```powershell
npx.cmd vitest run tests/unit/worker/first-last-frame-prompt.test.ts tests/integration/api/specific/first-last-frame-prompt-route.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```powershell
git add src/lib/workers/handlers/first-last-frame-prompt.ts src/app/api/novel-promotion/[projectId]/first-last-frame-prompt/route.ts tests/unit/worker/first-last-frame-prompt.test.ts tests/integration/api/specific/first-last-frame-prompt-route.test.ts
git commit -m "feat: persist smart first-last duration recommendations"
```

---

### Task 5: Frontend Default, Manual Override, and Restore Smart

**Files:**
- Modify: `src/lib/novel-promotion/stages/video-stage-runtime/useFirstLastFramePromptEntries.ts`
- Modify: `src/lib/novel-promotion/stages/video-stage-runtime/useVideoFirstLastFrameFlow.ts`
- Modify: `src/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry.ts`
- Modify: `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/panel-card/VideoPanelCardBody.tsx`
- Test: `tests/unit/novel-promotion/first-last-frame-prompt-entry.test.ts`

**Interfaces:**
- Consumes: persisted smart binding metadata from Task 4.
- Produces: `restoreFirstLastFrameSmartDuration(panelKey: string): Promise<void>` from `useVideoFirstLastFrameFlow`.
- Produces: `layout.flDurationStatus` with:

```ts
type FirstLastFrameDurationStatus = {
  source: 'smart' | 'manual' | 'default' | 'analyzing'
  durationSeconds: number
  reason?: string
  canRestoreSmart: boolean
}
```

- [ ] **Step 1: Write failing helper tests**

Add to `tests/unit/novel-promotion/first-last-frame-prompt-entry.test.ts`:

```ts
it('restores smart duration from a manual binding when a matching recommendation exists', async () => {
  const { restoreFirstLastFrameSmartDurationBinding } = await import(
    '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
  )

  expect(restoreFirstLastFrameSmartDurationBinding({
    mode: 'manual',
    targetDurationSeconds: 6,
    durationSource: 'manual',
    recommendationConfidence: 0.88,
    recommendationReason: '包含移动和镜头推进',
    recommendationFingerprint: 'smart-fp',
  }, 8)).toEqual({
    mode: 'manual',
    voiceLineIds: [],
    targetDurationSeconds: 8,
    durationSource: 'smart',
    recommendationConfidence: 0.88,
    recommendationReason: '包含移动和镜头推进',
    recommendationFingerprint: 'smart-fp',
  })
})

it('does not trigger prompt regeneration for duration-only manual selection', async () => {
  const { shouldEnsurePromptAfterDurationSelection } = await import(
    '@/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry'
  )

  expect(shouldEnsurePromptAfterDurationSelection({
    previousDuration: 8,
    nextDuration: 6,
    sourceChanged: false,
  })).toBe(false)
  expect(shouldEnsurePromptAfterDurationSelection({
    previousDuration: 8,
    nextDuration: 8,
    sourceChanged: true,
  })).toBe(true)
})
```

- [ ] **Step 2: Run helper tests and verify failure**

Run:

```powershell
npx.cmd vitest run tests/unit/novel-promotion/first-last-frame-prompt-entry.test.ts
```

Expected: FAIL because restore and prompt-ensure helpers do not exist.

- [ ] **Step 3: Implement restore helpers**

In `first-last-frame-prompt-entry.ts`, add:

```ts
export function restoreFirstLastFrameSmartDurationBinding(
  current: VideoDurationBinding,
  smartDurationSeconds?: number | null,
): VideoDurationBinding | null {
  const duration = typeof smartDurationSeconds === 'number' && Number.isFinite(smartDurationSeconds)
    ? normalizeLtx23GoonDurationSeconds(smartDurationSeconds)
    : normalizeLtx23GoonDurationSeconds(current.targetDurationSeconds)
  if (!duration || current.recommendationFingerprint === undefined) return null
  return {
    mode: 'manual',
    voiceLineIds: current.voiceLineIds ?? [],
    targetDurationSeconds: duration,
    durationSource: 'smart',
    ...(current.recommendationConfidence !== undefined ? { recommendationConfidence: current.recommendationConfidence } : {}),
    ...(current.recommendationReason ? { recommendationReason: current.recommendationReason } : {}),
    recommendationFingerprint: current.recommendationFingerprint,
    ...(current.recommendationAlgorithmVersion ? { recommendationAlgorithmVersion: current.recommendationAlgorithmVersion } : {}),
  }
}

export function shouldEnsurePromptAfterDurationSelection(params: {
  previousDuration?: number | null
  nextDuration?: number | null
  sourceChanged: boolean
}): boolean {
  return params.sourceChanged
}
```

- [ ] **Step 4: Wire manual selection without prompt regeneration**

In `useVideoFirstLastFrameFlow.ts`, after persisting `durationSelection.binding`, remove unconditional `await ensurePrompt(panelKey, 'source_change')`. Replace it with:

```ts
if (shouldEnsurePromptAfterDurationSelection({
  previousDuration: currentOptions.duration as number | undefined,
  nextDuration: durationSelection.generationOptions.duration as number | undefined,
  sourceChanged: false,
})) {
  await ensurePrompt(panelKey, 'source_change')
}
```

Manual duration changes must update `flGenerationOptionsByPanel` and persisted binding only.

- [ ] **Step 5: Add restore action in flow hook**

Add `restoreSmartDuration` to the hook return. It should:

1. Find the first panel by `panelKey`.
2. Normalize `firstPanel.videoDurationBinding`.
3. Build `nextBinding` with `restoreFirstLastFrameSmartDurationBinding`.
4. Persist with `onUpdatePanelVideoDurationBinding`.
5. Update `flGenerationOptionsByPanel` to `{ ...currentOptions, duration: nextBinding.targetDurationSeconds }`.
6. Call `confirmPersistedDuration(panelKey, nextBinding)`.

Use:

```ts
const restoreSmartDuration = useCallback(async (panelKey: string) => {
  const firstPanel = allPanels.find((panel) => `${panel.storyboardId}-${panel.panelIndex}` === panelKey)
  if (!firstPanel) return
  const currentBinding = getPersistedDurationOverride(panelKey) || firstPanel.videoDurationBinding
  const nextBinding = restoreFirstLastFrameSmartDurationBinding(currentBinding)
  if (!nextBinding) return
  beginDurationPersistence(panelKey)
  try {
    await onUpdatePanelVideoDurationBinding(firstPanel.storyboardId, firstPanel.panelIndex, nextBinding)
    setFlGenerationOptionsByPanel((previous) => new Map(previous).set(panelKey, {
      ...resolvePanelFirstLastFrameGenerationOptions(panelKey, flGenerationOptions, previous, nextBinding),
      duration: nextBinding.targetDurationSeconds,
    }))
    confirmPersistedDuration(panelKey, nextBinding)
  } catch (error) {
    failDurationPersistence(panelKey, error)
  }
}, [allPanels, beginDurationPersistence, confirmPersistedDuration, failDurationPersistence, flGenerationOptions, getPersistedDurationOverride, onUpdatePanelVideoDurationBinding])
```

- [ ] **Step 6: Show status in card UI**

In `VideoPanelCardBody.tsx`, near the first/last-frame `ModelCapabilityDropdown`, render only when `showsFirstLastFrameActions`:

```tsx
{layout.flDurationStatus ? (
  <div className="mt-1 rounded-lg bg-[var(--glass-bg-muted)] px-2 py-1.5 text-[10px] text-[var(--glass-text-tertiary)]">
    {layout.flDurationStatus.source === 'smart' && (
      <span>{layout.flDurationStatus.durationSeconds}s 智能推荐{layout.flDurationStatus.reason ? `：${layout.flDurationStatus.reason}` : ''}</span>
    )}
    {layout.flDurationStatus.source === 'manual' && (
      <span>时长来源：手动</span>
    )}
    {layout.flDurationStatus.canRestoreSmart && (
      <button
        type="button"
        onClick={() => { void actions.onRestoreFlSmartDuration(panelKey) }}
        className="ml-2 text-[var(--glass-tone-info-fg)] underline"
      >
        恢复智能推荐
      </button>
    )}
  </div>
) : null}
```

Do not show this block for normal single-image videos.

- [ ] **Step 7: Run Task 5 tests**

Run:

```powershell
npx.cmd vitest run tests/unit/novel-promotion/first-last-frame-prompt-entry.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

```powershell
git add src/lib/novel-promotion/stages/video-stage-runtime/useFirstLastFramePromptEntries.ts src/lib/novel-promotion/stages/video-stage-runtime/useVideoFirstLastFrameFlow.ts src/lib/novel-promotion/stages/video-stage-runtime/first-last-frame-prompt-entry.ts src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/panel-card/VideoPanelCardBody.tsx tests/unit/novel-promotion/first-last-frame-prompt-entry.test.ts
git commit -m "feat: default first-last duration to smart recommendation"
```

---

### Task 6: Generate-Video Payload and Regression Verification

**Files:**
- Modify: `src/app/api/novel-promotion/[projectId]/generate-video/route.ts`
- Modify: `src/lib/workers/video.worker.ts`
- Test: existing generate-video route/worker tests if present
- Test: `tests/unit/providers/comfyui/ltx23-workflow-router.test.ts`

**Interfaces:**
- Consumes: smart/manual `VideoDurationBinding`.
- Produces: first/last-frame `generationOptions.duration` and route `targetDurationSeconds` using manual > audio > smart > saved > default priority.

- [ ] **Step 1: Add failing route assertions**

Find existing generate-video tests with:

```powershell
rg -n "generate-video|resolveEffectiveVideoDurationBinding|videoDurationBinding" tests
```

In the matching route test file, add assertions equivalent to:

```ts
it('uses smart first-last duration as the generation target when no manual override exists', async () => {
  const requestBody = buildGenerateVideoBody({
    generationMode: 'firstlastframe',
    generationOptions: { duration: 10 },
    videoDurationBinding: {
      mode: 'manual',
      targetDurationSeconds: 8,
      durationSource: 'smart',
      recommendationFingerprint: 'smart-fp',
    },
  })

  const response = await callGenerateVideoRoute(requestBody)

  expect(response.status).toBe(200)
  expect(submittedTaskPayload()).toMatchObject({
    generationOptions: expect.objectContaining({ duration: 8 }),
    videoDurationBinding: expect.objectContaining({
      targetDurationSeconds: 8,
      durationSource: 'smart',
    }),
  })
})

it('keeps manual first-last duration above a newer smart recommendation', async () => {
  const requestBody = buildGenerateVideoBody({
    generationMode: 'firstlastframe',
    generationOptions: { duration: 8 },
    videoDurationBinding: {
      mode: 'manual',
      targetDurationSeconds: 6,
      durationSource: 'manual',
      recommendationFingerprint: 'smart-fp',
      recommendationReason: '包含移动',
    },
  })

  const response = await callGenerateVideoRoute(requestBody)

  expect(response.status).toBe(200)
  expect(submittedTaskPayload()).toMatchObject({
    generationOptions: expect.objectContaining({ duration: 6 }),
    videoDurationBinding: expect.objectContaining({
      targetDurationSeconds: 6,
      durationSource: 'manual',
    }),
  })
})
```

Use the existing helper names in that test file; do not create duplicate route harnesses.

- [ ] **Step 2: Run generate-video tests and verify failure**

Run the exact test file found in Step 1 with `npx.cmd vitest run <file>`.

Expected: FAIL if the route still lets stale `generationOptions.duration` override smart/manual binding.

- [ ] **Step 3: Update route duration priority**

In `src/app/api/novel-promotion/[projectId]/generate-video/route.ts`, update the effective binding and generation option resolution so first/last-frame route uses:

```ts
const bindingTarget = videoDurationBinding?.targetDurationSeconds
const requestedDuration = typeof generationOptions.duration === 'number'
  ? generationOptions.duration
  : null
const firstLastTargetDuration = videoGenerationMode === 'firstlastframe'
  ? normalizeLtx23GoonDurationSeconds(bindingTarget ?? requestedDuration)
  : requestedDuration
```

When writing task payload:

```ts
generationOptions: {
  ...generationOptions,
  ...(videoGenerationMode === 'firstlastframe' ? { duration: firstLastTargetDuration } : {}),
}
```

Keep `match_audio` behavior for normal mode unchanged.

- [ ] **Step 4: Update worker fallback if payload omits duration**

In `src/lib/workers/video.worker.ts`, ensure first/last-frame worker-side route has the same fallback:

```ts
const savedBinding = parseVideoDurationBinding(panel.videoDurationBinding)
const payloadBinding = parseVideoDurationBinding(payload.videoDurationBinding)
const effectiveBinding = payloadBinding.targetDurationSeconds ? payloadBinding : savedBinding
if (generationMode === 'firstlastframe' && effectiveBinding.targetDurationSeconds) {
  generationOptions.duration = normalizeLtx23GoonDurationSeconds(effectiveBinding.targetDurationSeconds)
}
```

Do not change non-first/last-frame behavior.

- [ ] **Step 5: Run Task 6 tests**

Run:

```powershell
npx.cmd vitest run tests/unit/providers/comfyui/ltx23-workflow-router.test.ts
```

Run the generate-video test file found in Step 1.

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```powershell
git add src/app/api/novel-promotion/[projectId]/generate-video/route.ts src/lib/workers/video.worker.ts tests
git commit -m "feat: honor smart first-last duration in video generation"
```

---

### Task 7: Final Regression Suite and Manual Validation

**Files:**
- No planned code changes.
- Uses all modified files.

**Interfaces:**
- Consumes: completed Tasks 1-6.
- Produces: verification evidence before completion.

- [ ] **Step 1: Run targeted unit and integration tests**

Run:

```powershell
npx.cmd vitest run tests/unit/novel-promotion/first-last-frame-smart-duration.test.ts tests/unit/novel-promotion/first-last-frame-prompt-entry.test.ts tests/unit/novel-promotion/first-last-frame-prompt-fingerprint-input.test.ts tests/unit/video/audio-binding.test.ts tests/unit/worker/first-last-frame-prompt.test.ts tests/integration/api/specific/first-last-frame-prompt-route.test.ts tests/unit/providers/comfyui/ltx23-workflow-profiles.test.ts tests/unit/providers/comfyui/workflow-registry.test.ts tests/unit/providers/comfyui/ltx23-workflow-router.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run static checks available in package scripts**

Inspect scripts:

```powershell
npm.cmd run
```

Run the repo's existing type/lint checks if present. Prefer:

```powershell
npm.cmd run typecheck
npm.cmd run lint
```

Expected: PASS or command absent. If a command is absent, record the exact npm error in the final handoff.

- [ ] **Step 3: Verify generated workflow payloads for 4, 8, 10, and 15 seconds**

Run or add a focused workflow-registry test that calls `resolveComfyUiWorkflow` for Goon with:

```ts
for (const durationSeconds of [4, 8, 10, 15]) {
  const graph = resolveComfyUiWorkflow(COMFYUI_LTX23_WORKFLOW_KEYS.goonFirstLastFrame, {
    prompt: 'A stable first-last-frame transition prompt with natural motion.',
    imageFilenames: ['first.png', 'last.png'],
    fps: 24,
    durationSeconds,
  })
  expect(graph['236']?.inputs.value).toBe(durationSeconds)
  expect(graph['233']?.inputs.value).toBe(24)
  expect(graph['265']?.inputs['num_images.index_2']).toBe(durationSeconds * 24)
  expect(graph['275']?.inputs['num_images.index_2']).toBe(durationSeconds * 24)
}
```

If the node value field is not `value`, use the existing `workflow-registry.test.ts` helper that reads numeric node values.

- [ ] **Step 4: Optional live runtime validation when the stack is available**

If the user has the dev stack running, create four first/last-frame video jobs with smart/manual target durations 4, 8, 10, and 15 seconds. Verify:

```text
payload generationOptions.duration = target duration
ComfyUI duration node = target duration
ComfyUI fps node = 24
ComfyUI final frame index = duration * 24
MP4 duration is approximately target duration + 1/24 second
manual override survives prompt regeneration
restore smart recommendation switches the dropdown back to smart value
```

If the stack is not available, do not block completion on live generation; record that local unit/integration workflow payload verification was completed and live MP4 validation remains external.

- [ ] **Step 5: Inspect git diff**

Run:

```powershell
git status --short
git diff --check
git log --oneline -5
```

Expected: no whitespace errors; modified files match this plan; branch contains the feature commits.

- [ ] **Step 6: Use verification-before-completion**

Before claiming completion, read and follow `superpowers:verification-before-completion`. Report exact commands run and their pass/fail status.

- [ ] **Step 7: Use requesting-code-review**

Read and follow `superpowers:requesting-code-review` after implementation passes local verification. If review feedback is returned, use `superpowers:receiving-code-review` before applying it.

- [ ] **Step 8: Finish branch**

Read and follow `superpowers:finishing-a-development-branch`. Present merge/PR/cleanup options according to that skill.

---

## Self-Review

**Spec coverage:** This plan maps the confirmed spec to implementation tasks: first/last-only scope in Tasks 3, 5, and 6; no extra AI request in Task 4; manual priority in Tasks 3, 4, 5, and 6; 4-15 Goon capability in Task 1; structured AI analysis and deterministic calculator in Task 2; fallback behavior in Tasks 2 and 4; UI state in Task 5; final verification in Task 7.

**Placeholder scan:** The plan contains no deferred-work markers. Each task gives concrete tests, files, commands, expected failure, implementation target, and commit command.

**Type consistency:** The shared names are consistent across tasks: `durationSource`, `recommendationConfidence`, `recommendationReason`, `recommendationFingerprint`, `recommendationAlgorithmVersion`, `FirstLastFrameDurationAnalysis`, `FirstLastFrameSmartDurationRecommendation`, `computeFirstLastFrameSmartDuration`, `parseFirstLastFrameDurationAnalysis`, `buildFirstLastFrameSmartDurationFingerprint`, `resolveLtx23GoonFrameCount`, and `resolveLtx23GoonFinalFrameIndex`.
