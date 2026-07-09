import type { EditGenerationSegment, EditScriptShot } from './types'

export interface ShotExecutionPlanPromptGenerationSegment {
  readonly shotIds: readonly string[]
  readonly continuityReference: string
}

export interface ShotExecutionPlanPromptStructure {
  readonly id: string
  readonly durationSec: number
  readonly shotCount: number
  readonly sourceText: string | null
  readonly shots: readonly EditScriptShot[]
  readonly videoGenerationSegments: readonly ShotExecutionPlanPromptGenerationSegment[]
}

export function buildShotExecutionPlanPromptStructure(input: {
  readonly id: string
  readonly durationSec: number
  readonly shotCount: number
  readonly sourceText: string | null
  readonly shots: readonly EditScriptShot[]
  readonly generationSegments: readonly EditGenerationSegment[]
}): ShotExecutionPlanPromptStructure {
  return {
    id: input.id,
    durationSec: input.durationSec,
    shotCount: input.shotCount,
    sourceText: input.sourceText,
    shots: input.shots,
    videoGenerationSegments: input.generationSegments.map((segment) => ({
      shotIds: segment.shotIds,
      continuityReference: segment.continuity,
    })),
  }
}
