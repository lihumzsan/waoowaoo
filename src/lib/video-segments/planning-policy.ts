const ACTIVE_VIDEO_SEGMENT_STATUSES = new Set(['queued', 'processing', 'generating'])

export type ExistingVideoSegmentPlanningFact = {
  readonly id: string
  readonly inputSignature: string
  readonly status: string
  readonly generationTaskId: string | null
  readonly videoMediaId: string | null
}

export type VideoSegmentPlanningDecision =
  | { readonly kind: 'plan' }
  | { readonly kind: 'skip_active'; readonly taskId: string }
  | { readonly kind: 'skip_completed' }

export function resolveVideoSegmentPlanningDecision(input: {
  readonly existing: ExistingVideoSegmentPlanningFact | null
  readonly inputSignature: string
}): VideoSegmentPlanningDecision {
  const existing = input.existing
  if (!existing) return { kind: 'plan' }

  const sameInput = existing.inputSignature === input.inputSignature
  if (sameInput && existing.status === 'completed') {
    if (!existing.videoMediaId) {
      throw new Error(`VIDEO_SEGMENT_COMPLETED_MEDIA_MISSING:${existing.id}`)
    }
    return { kind: 'skip_completed' }
  }

  if (ACTIVE_VIDEO_SEGMENT_STATUSES.has(existing.status)) {
    if (!existing.generationTaskId) {
      throw new Error(`VIDEO_SEGMENT_ACTIVE_TASK_MISSING:${existing.id}`)
    }
    if (!sameInput) {
      throw new Error(`VIDEO_SEGMENT_REPLAN_IN_FLIGHT:${existing.id}`)
    }
    return { kind: 'skip_active', taskId: existing.generationTaskId }
  }

  return { kind: 'plan' }
}
