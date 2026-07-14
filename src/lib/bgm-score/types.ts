export const BGM_SCORE_STATUS = {
  PENDING: 'pending',
  PLANNING: 'planning',
  PLANNED: 'planned',
  GENERATING: 'generating',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const

export type BgmScoreStatus = (typeof BGM_SCORE_STATUS)[keyof typeof BGM_SCORE_STATUS]

export interface BgmScoreMix {
  readonly mediaId: string
  readonly url: string
  readonly storageKey: string
  readonly mimeType: string
  readonly durationMs: number
}

export interface BgmScoreCue {
  readonly cueId: string
  readonly index: number
  readonly startSeconds: number
  readonly endSeconds: number
  readonly durationSeconds: number
  readonly sourceClipOrders: readonly number[]
  readonly shotIds: readonly string[]
  readonly shotNumbers: readonly number[]
  readonly prompt: string
}

export interface ScoreCandidateAsset extends BgmScoreMix {
  readonly candidateIndex: 0 | 1
  readonly selected: boolean
  readonly quality: import('@/lib/audio-design/score-quality').ScoreCandidateQuality
}
