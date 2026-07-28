import { describe, expect, it } from 'vitest'
import {
  applyCreativeWorkerLifecycleEvent,
  isDurableCreativeWorkerTraceEvent,
} from '@/lib/creative-worker/lifecycle-projection'
import type {
  CreativeWorkTaskLifecycleProjection,
} from '@/lib/creative-worker/task-contract'

function initialLifecycle(): CreativeWorkTaskLifecycleProjection {
  return {
    requestKey: 'direction-1',
    outputKind: 'creative_direction',
    goal: 'Create one project direction.',
    events: [{
      sequence: 1,
      occurredAt: '2026-07-29T00:00:00.000Z',
      event: {
        kind: 'started',
        outputKind: 'creative_direction',
        goal: 'Create one project direction.',
      },
    }],
  }
}

describe('Creative Worker durable lifecycle projection', () => {
  it('persists generation, research, and submission outcomes with attempt-scoped identities', () => {
    let lifecycle = initialLifecycle()
    const apply = (
      rawEvent: Parameters<typeof applyCreativeWorkerLifecycleEvent>[0]['rawEvent'],
    ) => {
      lifecycle = applyCreativeWorkerLifecycleEvent({
        lifecycle,
        rawEvent,
        attempt: 2,
        occurredAt: '2026-07-29T00:01:00.000Z',
      })
    }

    apply({
      kind: 'generation',
      generationId: 'generation-1',
      phase: 'creating_output',
      status: 'running',
    })
    apply({
      kind: 'generation',
      generationId: 'generation-1',
      phase: 'creating_output',
      status: 'completed',
    })
    apply({
      kind: 'research_started',
      researchId: 'research-1',
      query: 'analog horror evidence',
    })
    apply({
      kind: 'research_completed',
      researchId: 'research-1',
      query: 'analog horror evidence',
      status: 'completed',
      sourceCount: 3,
      imageCount: 1,
    })
    apply({
      kind: 'submission_started',
      submissionId: 'submission-1',
    })
    apply({
      kind: 'submission_rejected',
      submissionId: 'submission-1',
      outputChars: 7_450,
      inputDiagnostic: {
        inputType: 'object',
        rawArgumentChars: 7_450,
        topLevelKeyCount: 1,
        topLevelKeys: ['output'],
      },
      issues: [{
        path: '$.creativeDirection.visual',
        code: 'invalid_type',
        message: 'Expected object.',
      }],
    })
    apply({
      kind: 'submission_started',
      submissionId: 'submission-2',
    })
    apply({
      kind: 'submission_accepted',
      submissionId: 'submission-2',
      outputKind: 'creative_direction',
      outputChars: 7_500,
    })

    expect(lifecycle.events).toHaveLength(5)
    expect(lifecycle.events.map((entry) => entry.event)).toEqual([
      expect.objectContaining({ kind: 'started' }),
      expect.objectContaining({
        kind: 'generation',
        generationId: '2:generation-1',
        status: 'completed',
      }),
      expect.objectContaining({
        kind: 'research_completed',
        researchId: '2:research-1',
      }),
      expect.objectContaining({
        kind: 'submission_rejected',
        submissionId: '2:submission-1',
        issues: [expect.objectContaining({
          path: '$.creativeDirection.visual',
        })],
      }),
      expect.objectContaining({
        kind: 'submission_accepted',
        submissionId: '2:submission-2',
      }),
    ])
  })

  it('classifies only durable trace events for Task progress persistence', () => {
    expect(isDurableCreativeWorkerTraceEvent({
      kind: 'submission_rejected',
      submissionId: 'submission-1',
      outputChars: 10,
      inputDiagnostic: {
        inputType: 'object',
        rawArgumentChars: 10,
        topLevelKeyCount: 0,
        topLevelKeys: [],
      },
      issues: [{
        path: '$',
        code: 'invalid_type',
        message: 'Expected object.',
      }],
    })).toBe(true)
    expect(isDurableCreativeWorkerTraceEvent({
      kind: 'output_delta',
      delta: '{',
    })).toBe(false)
  })
})
