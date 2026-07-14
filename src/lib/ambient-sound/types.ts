export const AMBIENT_SOUND_STATUS = {
  PENDING: 'pending',
  PLANNING: 'planning',
  PLANNED: 'planned',
  GENERATING: 'generating',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const

export type AmbientSoundStatus = (typeof AMBIENT_SOUND_STATUS)[keyof typeof AMBIENT_SOUND_STATUS]

export const AMBIENT_SOUND_OUTPUT_FORMAT = 'mp3_44100_128'

export interface AmbientSoundSourceAsset {
  readonly sourceId: string
  readonly sourceContinuityId: string
  readonly candidateIndex: 0 | 1
  readonly selected: boolean
  readonly prompt: string
  readonly mediaId: string
  readonly url: string
  readonly storageKey: string
  readonly mimeType: string
  readonly durationMs: number
  readonly loopDurationSeconds: number
  readonly promptInfluence: number
  readonly soundEffectModel: string
  readonly range: { readonly startFrame: number; readonly endFrameExclusive: number }
  readonly loop: boolean
  readonly crossfadeFrames: number
  readonly phaseOffsetFrames: number
  readonly boundaryScore: number
  readonly quality: import('@/lib/audio-design/ambience-loop').AmbienceCandidateQualityMeasurement
}

export interface AmbientSoundMix {
  readonly mediaId: string
  readonly url: string
  readonly storageKey: string
  readonly mimeType: string
  readonly durationMs: number
}
