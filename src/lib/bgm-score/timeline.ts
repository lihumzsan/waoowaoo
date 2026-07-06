import { createHash } from 'node:crypto'
import type { FinalRenderClipPlan } from '@/lib/video-compose/final-render-plan'

export function buildBgmTimelineSignature(clips: readonly FinalRenderClipPlan[]): string {
  const payload = clips.map((clip) => ({
    order: clip.order,
    sourceKind: clip.sourceKind,
    panelId: clip.panelId,
    groupId: clip.groupId ?? null,
    shotIds: clip.shotIds,
    shotNumbers: clip.shotNumbers,
    durationSeconds: clip.durationSeconds,
  }))
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 24)
}
