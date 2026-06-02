export const VIDEO_GRID_MODES = ['2x2', '3x3'] as const
export type VideoGridMode = (typeof VIDEO_GRID_MODES)[number]

export interface VideoGroupShot {
  readonly shotNumber: number
  readonly durationSec: number
  readonly dramaticPurpose: string
  readonly visibleAction: string
  readonly audienceFocus: string
  readonly viewpoint: string
  readonly revealPlan: string
  readonly performanceBeat: string
  readonly continuityIn: string
  readonly continuityOut: string
  readonly charactersAndScene?: string | null
  readonly sound: string
}

export type VideoBlockPlanItemKind = 'single' | 'group'

export interface VideoBlockPlanItem {
  readonly kind: VideoBlockPlanItemKind
  readonly shotNumbers: readonly number[]
  readonly gridMode?: VideoGridMode
  readonly reason: string
  readonly prompt: string
}

export interface VideoBlockPlan {
  readonly items: readonly VideoBlockPlanItem[]
}
