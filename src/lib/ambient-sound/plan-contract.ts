import { createHash } from 'node:crypto'
import type { FinalRenderClipPlan } from '@/lib/video-compose/final-render-plan'
import {
  ambientSoundPlanSchema,
  ambientSoundRawPlanSchema,
  type AmbientSoundPlan,
  type AmbientSoundRawPlan,
} from './types'

export function parseAmbientSoundPlanStrict(value: unknown): AmbientSoundPlan {
  const result = ambientSoundPlanSchema.safeParse(value)
  if (!result.success) {
    throw new Error(`AMBIENT_SOUND_PLAN_INVALID:${result.error.issues.map((issue) => issue.message).join(',')}`)
  }
  return result.data
}

export function parseAmbientSoundRawPlanStrict(value: unknown): AmbientSoundRawPlan {
  const result = ambientSoundRawPlanSchema.safeParse(value)
  if (!result.success) {
    throw new Error(`AMBIENT_SOUND_RAW_PLAN_INVALID:${result.error.issues.map((issue) => issue.message).join(',')}`)
  }
  return result.data
}

export function resolveAmbientSoundPlanReferences(
  value: unknown,
  clips: readonly FinalRenderClipPlan[],
): AmbientSoundPlan {
  const raw = parseAmbientSoundRawPlanStrict(value)
  const clipByOrder = new Map(clips.map((clip) => [clip.order, clip]))
  return parseAmbientSoundPlanStrict({
    ...raw,
    sections: raw.sections.map(({ fromClipOrder, toClipOrder, ...section }) => {
      if (toClipOrder < fromClipOrder) {
        throw new Error(`AMBIENT_SOUND_CLIP_ANCHOR_ORDER_INVALID:${fromClipOrder}:${toClipOrder}`)
      }
      const fromClip = clipByOrder.get(fromClipOrder)
      const toClip = clipByOrder.get(toClipOrder)
      const fromShotId = fromClip?.shotIds[0]
      const toShotId = toClip?.shotIds[toClip.shotIds.length - 1]
      if (!fromShotId || !toShotId) {
        throw new Error(`AMBIENT_SOUND_CLIP_ANCHOR_NOT_FOUND:${fromClipOrder}:${toClipOrder}`)
      }
      return { ...section, fromShotId, toShotId }
    }),
  })
}

export function buildAmbientSoundPlanFingerprint(input: {
  readonly plan: AmbientSoundPlan
  readonly timelineSignature: string
  readonly soundEffectModel: string
}): string {
  return createHash('sha256').update(JSON.stringify({
    plan: input.plan,
    timelineSignature: input.timelineSignature,
    soundEffectModel: input.soundEffectModel,
  })).digest('hex')
}
