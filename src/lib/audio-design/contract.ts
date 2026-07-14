import { createHash } from 'node:crypto'
import type { FinalRenderClipPlan } from '@/lib/video-compose/final-render-plan'
import { audioDesignSchema, type AudioDesign } from './types'

export function parseAudioDesignStrict(value: unknown): AudioDesign {
  const result = audioDesignSchema.safeParse(value)
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.')}:${issue.message}`).join(',')
    throw new Error(`AUDIO_DESIGN_INVALID:${issues}`)
  }
  return result.data
}

export function buildAudioDesignTimelineSignature(clips: readonly FinalRenderClipPlan[]): string {
  if (clips.length === 0) throw new Error('AUDIO_DESIGN_TIMELINE_EMPTY')
  return createHash('sha256').update(JSON.stringify(clips.map((clip) => ({
    sourceKind: clip.sourceKind,
    sourceId: clip.sourceId,
    segmentId: clip.segmentId,
    order: clip.order,
    durationSeconds: clip.durationSeconds,
    shotIds: clip.shotIds,
    shotNumbers: clip.shotNumbers,
  })))).digest('hex')
}

export function buildAudioDesignSignature(input: {
  readonly design: AudioDesign
  readonly timelineSignature: string
  readonly musicModel: string
  readonly soundEffectModel: string
}): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}
