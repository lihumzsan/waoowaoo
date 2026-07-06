import type { EditGenerationSegment, EditScriptShot } from './types'

export const EDIT_GENERATION_SEGMENT_MAX_DURATION_SEC = 15

export const EDIT_GENERATION_SEGMENT_DURATION_EXCEEDED_CODE =
  'EDIT_SCRIPT_GENERATION_SEGMENT_DURATION_EXCEEDED'

export interface EditGenerationSegmentDurationIssue {
  readonly code: typeof EDIT_GENERATION_SEGMENT_DURATION_EXCEEDED_CODE
  readonly shotIds: readonly string[]
  readonly durationSec: number
  readonly maxDurationSec: number
}

function durationByShotId(
  shots: readonly Pick<EditScriptShot, 'shotId' | 'durationSec'>[],
): ReadonlyMap<string, number> {
  return new Map(shots.map((shot) => [shot.shotId, shot.durationSec]))
}

export function calculateEditGenerationSegmentDuration(input: {
  readonly shots: readonly Pick<EditScriptShot, 'shotId' | 'durationSec'>[]
  readonly segment: Pick<EditGenerationSegment, 'shotIds'>
}): number {
  const durations = durationByShotId(input.shots)
  return input.segment.shotIds.reduce((total, shotId) => {
    const durationSec = durations.get(shotId)
    if (durationSec === undefined) {
      throw new Error(`EDIT_SCRIPT_GENERATION_SEGMENT_SHOT_DURATION_MISSING:${shotId}`)
    }
    return total + durationSec
  }, 0)
}

export function findEditGenerationSegmentDurationIssues(input: {
  readonly shots: readonly Pick<EditScriptShot, 'shotId' | 'durationSec'>[]
  readonly segments: readonly Pick<EditGenerationSegment, 'shotIds'>[]
  readonly maxDurationSec?: number
}): EditGenerationSegmentDurationIssue[] {
  const maxDurationSec = input.maxDurationSec ?? EDIT_GENERATION_SEGMENT_MAX_DURATION_SEC
  return input.segments.flatMap((segment): EditGenerationSegmentDurationIssue[] => {
    const durationSec = calculateEditGenerationSegmentDuration({
      shots: input.shots,
      segment,
    })
    if (durationSec <= maxDurationSec) return []
    return [{
      code: EDIT_GENERATION_SEGMENT_DURATION_EXCEEDED_CODE,
      shotIds: [...segment.shotIds],
      durationSec,
      maxDurationSec,
    }]
  })
}

export function formatEditGenerationSegmentDurationIssue(
  issue: EditGenerationSegmentDurationIssue,
): string {
  return `${issue.code}:shots=${issue.shotIds.join(',')}:duration=${String(issue.durationSec)}:max=${String(issue.maxDurationSec)}`
}

export function assertEditGenerationSegmentDurationsSupported(input: {
  readonly shots: readonly Pick<EditScriptShot, 'shotId' | 'durationSec'>[]
  readonly segments: readonly Pick<EditGenerationSegment, 'shotIds'>[]
  readonly maxDurationSec?: number
}): void {
  const issue = findEditGenerationSegmentDurationIssues(input)[0]
  if (issue) throw new Error(formatEditGenerationSegmentDurationIssue(issue))
}
