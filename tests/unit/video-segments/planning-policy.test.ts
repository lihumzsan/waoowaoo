import { describe, expect, it } from 'vitest'
import { resolveVideoSegmentPlanningDecision } from '@/lib/video-segments/planning-policy'

const activeSegment = {
  id: 'video-segment-1',
  inputSignature: 'signature-1',
  status: 'processing',
  generationTaskId: 'task-1',
  videoMediaId: null,
}

/**
 * Logic Specification
 * Authority: the video-segment planner is the only interpreter of persisted segment execution state.
 * Rejects: batch resubmission of an already-active single segment, silent overwrite of different
 * active input, or treating a completed segment without media as reusable.
 * Production entry: resolveVideoSegmentPlanningDecision from planGenerateVideoSegments.
 * Oracle: same-input active/completed facts are skipped; incompatible active facts fail closed;
 * failed and cancellation-projected pending facts can produce a new task after terminal dedupe release.
 * Command: npx vitest run tests/unit/video-segments/planning-policy.test.ts
 */
describe('resolveVideoSegmentPlanningDecision', () => {
  it('skips an active segment with the same immutable input signature', () => {
    expect(resolveVideoSegmentPlanningDecision({
      existing: activeSegment,
      inputSignature: 'signature-1',
    })).toEqual({ kind: 'skip_active', taskId: 'task-1' })
  })

  it('fails closed when an active segment has different immutable input', () => {
    expect(() => resolveVideoSegmentPlanningDecision({
      existing: activeSegment,
      inputSignature: 'signature-2',
    })).toThrow('VIDEO_SEGMENT_REPLAN_IN_FLIGHT:video-segment-1')
  })

  it('skips a completed segment only when its output is materialized', () => {
    expect(resolveVideoSegmentPlanningDecision({
      existing: {
        ...activeSegment,
        status: 'completed',
        videoMediaId: 'media-1',
      },
      inputSignature: 'signature-1',
    })).toEqual({ kind: 'skip_completed' })

    expect(() => resolveVideoSegmentPlanningDecision({
      existing: { ...activeSegment, status: 'completed' },
      inputSignature: 'signature-1',
    })).toThrow('VIDEO_SEGMENT_COMPLETED_MEDIA_MISSING:video-segment-1')
  })

  it.each(['failed', 'pending'])('allows a new task after %s state', (status) => {
    expect(resolveVideoSegmentPlanningDecision({
      existing: { ...activeSegment, status, generationTaskId: null },
      inputSignature: 'signature-1',
    })).toEqual({ kind: 'plan' })
  })
})
