import type { EditGenerationSegment, EditScriptShot } from './types'

export const EDIT_GENERATION_SEGMENT_MAX_DURATION_SEC = 15

export const EDIT_GENERATION_SEGMENT_DURATION_EXCEEDED_CODE =
  'EDIT_SCRIPT_GENERATION_SEGMENT_DURATION_EXCEEDED'

export interface EditGenerationSegmentDurationIssue {
  readonly code: typeof EDIT_GENERATION_SEGMENT_DURATION_EXCEEDED_CODE
  readonly shotNumbers: readonly number[]
  readonly durationSec: number
  readonly maxDurationSec: number
}

function durationByShotNumber(
  shots: readonly Pick<EditScriptShot, 'shotNumber' | 'durationSec'>[],
): ReadonlyMap<number, number> {
  return new Map(shots.map((shot) => [shot.shotNumber, shot.durationSec]))
}

export function calculateEditGenerationSegmentDuration(input: {
  readonly shots: readonly Pick<EditScriptShot, 'shotNumber' | 'durationSec'>[]
  readonly segment: Pick<EditGenerationSegment, 'shotNumbers'>
}): number {
  const durations = durationByShotNumber(input.shots)
  return input.segment.shotNumbers.reduce((total, shotNumber) => {
    const durationSec = durations.get(shotNumber)
    if (durationSec === undefined) {
      throw new Error(`EDIT_SCRIPT_GENERATION_SEGMENT_SHOT_DURATION_MISSING:${String(shotNumber)}`)
    }
    return total + durationSec
  }, 0)
}

export function findEditGenerationSegmentDurationIssues(input: {
  readonly shots: readonly Pick<EditScriptShot, 'shotNumber' | 'durationSec'>[]
  readonly segments: readonly Pick<EditGenerationSegment, 'shotNumbers'>[]
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
      shotNumbers: [...segment.shotNumbers],
      durationSec,
      maxDurationSec,
    }]
  })
}

export function formatEditGenerationSegmentDurationIssue(
  issue: EditGenerationSegmentDurationIssue,
): string {
  return `${issue.code}:shots=${issue.shotNumbers.join(',')}:duration=${String(issue.durationSec)}:max=${String(issue.maxDurationSec)}`
}

export function assertEditGenerationSegmentDurationsSupported(input: {
  readonly shots: readonly Pick<EditScriptShot, 'shotNumber' | 'durationSec'>[]
  readonly segments: readonly Pick<EditGenerationSegment, 'shotNumbers'>[]
  readonly maxDurationSec?: number
}): void {
  const issue = findEditGenerationSegmentDurationIssues(input)[0]
  if (issue) throw new Error(formatEditGenerationSegmentDurationIssue(issue))
}
