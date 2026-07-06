export const VIDEO_GRID_MODES = ['2x2', '3x3'] as const
export type VideoGridMode = (typeof VIDEO_GRID_MODES)[number]

export interface VideoGroupShot {
  readonly shotId: string
  readonly shotNumber: number
  readonly durationSec: number
  readonly action: string
  readonly sceneName: string
  readonly characters: readonly string[]
  readonly sound: string
}

export type GenerationSegmentVideoPlanItemKind = 'group'

export interface GenerationSegmentVideoPlanItem {
  readonly kind: GenerationSegmentVideoPlanItemKind
  readonly shotIds: readonly string[]
  readonly gridMode?: VideoGridMode
  readonly continuity: string
}

export interface GenerationSegmentVideoPlan {
  readonly items: readonly GenerationSegmentVideoPlanItem[]
}
