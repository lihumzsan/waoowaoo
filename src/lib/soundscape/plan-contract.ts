import { createHash } from 'node:crypto'
import { soundscapePlanSchema, type SoundscapePlan } from './types'

export function parseSoundscapePlanStrict(value: unknown): SoundscapePlan {
  const result = soundscapePlanSchema.safeParse(value)
  if (!result.success) {
    throw new Error(`SOUNDSCAPE_PLAN_INVALID:${result.error.issues.map((issue) => issue.message).join(',')}`)
  }
  return result.data
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
