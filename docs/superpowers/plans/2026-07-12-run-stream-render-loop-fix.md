# Run Stream Render Loop Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the videos-stage React update-depth error by disabling idle run-stream clocks and suppressing semantically redundant video state writes.

**Architecture:** A pure run-clock predicate controls the existing interval lifecycle. A focused video-state synchronization helper preserves previous object identity when normalized JSON-compatible values are equal; the affected hooks use functional state updates through that helper.

**Tech Stack:** React 19, TypeScript 5, Vitest 2, Next.js 15.

## Global Constraints

- Preserve live and recovered run elapsed-time updates at a 500 ms cadence.
- Do not change task recovery, retry, cancellation, video configuration, or generation semantics.
- Do not modify the existing migration worktree changes.
- Add no third-party equality dependency.

---

### Task 1: Active-only run-stream clock

**Files:**
- Create: `src/lib/query/hooks/run-stream/run-stream-clock.ts`
- Modify: `src/lib/query/hooks/run-stream/run-stream-state-runtime.ts:37,279-282`
- Test: `tests/unit/helpers/run-stream-clock.test.ts`

**Interfaces:**
- Produces: `shouldTickRunStreamClock(input: { isLiveRunning: boolean; isRecoveredRunning: boolean; status: RunState['status'] | 'idle' }): boolean`.
- Consumes: existing run-stream status and live/recovered flags.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { shouldTickRunStreamClock } from '@/lib/query/hooks/run-stream/run-stream-clock'

describe('shouldTickRunStreamClock', () => {
  it.each(['idle', 'completed', 'failed'] as const)('does not tick for %s streams', (status) => {
    expect(shouldTickRunStreamClock({ isLiveRunning: false, isRecoveredRunning: false, status })).toBe(false)
  })

  it('ticks for live, recovered, or running streams', () => {
    expect(shouldTickRunStreamClock({ isLiveRunning: true, isRecoveredRunning: false, status: 'idle' })).toBe(true)
    expect(shouldTickRunStreamClock({ isLiveRunning: false, isRecoveredRunning: true, status: 'idle' })).toBe(true)
    expect(shouldTickRunStreamClock({ isLiveRunning: false, isRecoveredRunning: false, status: 'running' })).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx.cmd vitest run tests/unit/helpers/run-stream-clock.test.ts`

Expected: FAIL because `run-stream-clock` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { RunState } from './types'

interface RunStreamClockState {
  isLiveRunning: boolean
  isRecoveredRunning: boolean
  status: RunState['status'] | 'idle'
}

export function shouldTickRunStreamClock(state: RunStreamClockState): boolean {
  return state.isLiveRunning || state.isRecoveredRunning || state.status === 'running'
}
```

In `run-stream-state-runtime.ts`, derive the predicate result and replace the unconditional effect:

```ts
const shouldTickClock = shouldTickRunStreamClock({
  isLiveRunning,
  isRecoveredRunning,
  status: runState?.status || 'idle',
})

useEffect(() => {
  if (!shouldTickClock) return
  setClock(Date.now())
  const timer = window.setInterval(() => setClock(Date.now()), 500)
  return () => window.clearInterval(timer)
}, [shouldTickClock])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx.cmd vitest run tests/unit/helpers/run-stream-clock.test.ts`

Expected: PASS with 0 failed tests.

### Task 2: Semantic video state synchronization

**Files:**
- Create: `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/panel-card/runtime/hooks/video-state-sync.ts`
- Modify: `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/panel-card/runtime/hooks/usePanelVideoDurationBinding.ts:39-41`
- Modify: `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/panel-card/runtime/hooks/usePanelVideoModel.ts:126-140`
- Test: `tests/unit/novel-promotion/video-state-sync.test.ts`

**Interfaces:**
- Produces: `retainEqualJsonState<T>(previous: T, next: T): T` for JSON-compatible normalized state.
- Consumes: normalized `VideoDurationBinding` and `VideoGenerationOptions` records.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { retainEqualJsonState } from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video/panel-card/runtime/hooks/video-state-sync'

describe('retainEqualJsonState', () => {
  it('retains the previous reference for semantically equal state', () => {
    const previous = { mode: 'match_audio', voiceLineIds: ['voice-1'] }
    expect(retainEqualJsonState(previous, { mode: 'match_audio', voiceLineIds: ['voice-1'] })).toBe(previous)
  })

  it('returns changed state', () => {
    const previous = { duration: 5, fps: 24 }
    const next = { duration: 10, fps: 24 }
    expect(retainEqualJsonState(previous, next)).toBe(next)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx.cmd vitest run tests/unit/novel-promotion/video-state-sync.test.ts`

Expected: FAIL because `video-state-sync` does not exist.

- [ ] **Step 3: Write minimal implementation and integrate it**

```ts
export function retainEqualJsonState<T>(previous: T, next: T): T {
  return JSON.stringify(previous) === JSON.stringify(next) ? previous : next
}
```

Update duration binding synchronization:

```ts
useEffect(() => {
  setLocalBinding((previous) => retainEqualJsonState(previous, normalizedBinding))
}, [normalizedBinding])
```

Update both generation-option effects so their computed next values pass through `retainEqualJsonState(previous, next)` and remove `selectedModelOverrides` from the first effect's dependencies because `selectedModelOverridesSignature` is the semantic dependency.

- [ ] **Step 4: Run focused tests to verify they pass**

Run: `npx.cmd vitest run tests/unit/novel-promotion/video-state-sync.test.ts tests/unit/helpers/run-stream-clock.test.ts`

Expected: PASS with 0 failed tests.

### Task 3: Regression and live verification

**Files:**
- Verify only; no additional production files expected.

**Interfaces:**
- Consumes: the completed clock predicate and semantic synchronization helper.
- Produces: verification evidence for the reported URL.

- [ ] **Step 1: Run focused regression tests**

Run: `npx.cmd vitest run tests/unit/helpers/run-stream-clock.test.ts tests/unit/novel-promotion/video-state-sync.test.ts tests/unit/helpers/recovery-probe.test.ts tests/unit/helpers/recovered-run-subscription.test.ts`

Expected: PASS with 0 failed tests.

- [ ] **Step 2: Run TypeScript validation**

Run: `npm.cmd run typecheck`

Expected: exit code 0.

- [ ] **Step 3: Inspect the scoped diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only planned files plus the user's pre-existing migration files are modified/untracked.

- [ ] **Step 4: Verify the live workspace**

Reload `http://localhost:3000/zh/workspace/1b839fd3-240d-421c-b0c7-18594cf60afb?episode=e22dada5-1a3e-474d-9996-63f06da4dd60&stage=videos`, wait at least 2 seconds, confirm the videos UI renders, and inspect browser error logs.

Expected: no `Maximum update depth exceeded` error across at least four former clock intervals.
