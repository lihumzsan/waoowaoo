import { createHash } from 'node:crypto'
import type { FinalRenderClipPlan } from '@/lib/video-compose/final-render-plan'
import { bgmDesignSchema, type BgmDesign } from './types'

export function parseBgmDesignStrict(value: unknown): BgmDesign {
  const result = bgmDesignSchema.safeParse(value)
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.')}:${issue.message}`).join(',')
    throw new Error(`BGM_DESIGN_INVALID:${issues}`)
  }
  return result.data
}

export function buildBgmDesignTimelineSignature(clips: readonly FinalRenderClipPlan[]): string {
  if (clips.length === 0) throw new Error('BGM_DESIGN_TIMELINE_EMPTY')
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

export function buildBgmDesignSignature(input: {
  readonly design: BgmDesign
  readonly timelineSignature: string
  readonly musicModel: string
}): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}
