import { createHash } from 'node:crypto'
import type { FinalRenderClipPlan } from '@/lib/video-compose/final-render-plan'
import {
  soundscapePlanSchema,
  soundscapeRawPlanSchema,
  type SoundscapePlan,
  type SoundscapeRawPlan,
} from './types'

export function parseSoundscapePlanStrict(value: unknown): SoundscapePlan {
  const result = soundscapePlanSchema.safeParse(value)
  if (!result.success) {
    throw new Error(`SOUNDSCAPE_PLAN_INVALID:${result.error.issues.map((issue) => issue.message).join(',')}`)
  }
  return result.data
}

export function parseSoundscapeRawPlanStrict(value: unknown): SoundscapeRawPlan {
  const result = soundscapeRawPlanSchema.safeParse(value)
  if (!result.success) {
    throw new Error(`SOUNDSCAPE_RAW_PLAN_INVALID:${result.error.issues.map((issue) => issue.message).join(',')}`)
  }
  return result.data
}

export function resolveSoundscapePlanReferences(
  value: unknown,
  clips: readonly FinalRenderClipPlan[],
): SoundscapePlan {
  const raw = parseSoundscapeRawPlanStrict(value)
  const clipByOrder = new Map(clips.map((clip) => [clip.order, clip]))
  return parseSoundscapePlanStrict({
    ...raw,
    sections: raw.sections.map(({ fromClipOrder, toClipOrder, ...section }) => {
      if (toClipOrder < fromClipOrder) {
        throw new Error(`SOUNDSCAPE_CLIP_ANCHOR_ORDER_INVALID:${fromClipOrder}:${toClipOrder}`)
      }
      const fromClip = clipByOrder.get(fromClipOrder)
      const toClip = clipByOrder.get(toClipOrder)
      const fromShotId = fromClip?.shotIds[0]
      const toShotId = toClip?.shotIds[toClip.shotIds.length - 1]
      if (!fromShotId || !toShotId) {
        throw new Error(`SOUNDSCAPE_CLIP_ANCHOR_NOT_FOUND:${fromClipOrder}:${toClipOrder}`)
      }
      return { ...section, fromShotId, toShotId }
    }),
  })
}

export function buildSoundscapePlanFingerprint(input: {
  readonly plan: SoundscapePlan
  readonly timelineSignature: string
  readonly soundEffectModel: string
}): string {
  return createHash('sha256').update(JSON.stringify({
    plan: input.plan,
    timelineSignature: input.timelineSignature,
    soundEffectModel: input.soundEffectModel,
  })).digest('hex')
}
