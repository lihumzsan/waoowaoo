import { createHash } from 'node:crypto'
import { bgmScorePlanSchema, type BgmScorePlan } from './types'

export function parseBgmScorePlanStrict(value: unknown): BgmScorePlan {
  const result = bgmScorePlanSchema.safeParse(value)
  if (!result.success) {
    throw new Error(`BGM_SCORE_PLAN_INVALID:${result.error.issues.map((issue) => issue.message).join(',')}`)
  }
  return result.data
}

export function buildBgmScorePlanFingerprint(input: {
  readonly plan: BgmScorePlan
  readonly timelineSignature: string
  readonly musicModel: string
}): string {
  return createHash('sha256').update(JSON.stringify({
    plan: input.plan,
    timelineSignature: input.timelineSignature,
    musicModel: input.musicModel,
  })).digest('hex')
}
