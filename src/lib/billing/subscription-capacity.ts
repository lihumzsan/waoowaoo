import { calcVideo } from './cost'
import { toChargeableCredits } from './credits'
import { OPENROUTER_SEEDANCE_2_VIDEO_MODEL_ID } from '@/lib/ai-providers/openrouter/models'

/**
 * What a credit balance actually buys.
 *
 * A number of credits means nothing on its own — nobody knows whether 9,000 is
 * a lot. One figure answers the question people actually have when comparing
 * plans: how many minutes of finished footage a month covers.
 *
 * Only footage. Images, audio and text all consume the same pool, so any second
 * figure would describe the same credits a second time and invite the reader to
 * add them together. One unit, stated once, is the honest form.
 *
 * It is computed from the same retail catalog that charges for the work, so a
 * price change moves the pricing page's claim with it rather than leaving it to
 * drift into fiction.
 */

/** The reference footage: Seedance 2.0 at 720p, priced per second. */
const REFERENCE_VIDEO = {
  model: `openrouter::${OPENROUTER_SEEDANCE_2_VIDEO_MODEL_ID}`,
  resolution: '720p',
  /** Priced as a clip, then reduced to a rate — the catalog quotes per clip. */
  sampleDurationSeconds: 10,
} as const

export interface CreditCapacityReference {
  /** Credits for one second of reference footage. */
  readonly videoCreditsPerSecond: number
  readonly videoResolution: string
}

export function resolveCreditCapacityReference(): CreditCapacityReference {
  const sampleCredits = toChargeableCredits(
    calcVideo(REFERENCE_VIDEO.model, REFERENCE_VIDEO.resolution, 1, {
      duration: REFERENCE_VIDEO.sampleDurationSeconds,
    }),
  )
  return {
    videoCreditsPerSecond: sampleCredits / REFERENCE_VIDEO.sampleDurationSeconds,
    videoResolution: REFERENCE_VIDEO.resolution,
  }
}

/**
 * Minutes of reference footage a credit amount covers.
 *
 * Kept to one decimal and always rounded down: "about 3.5 minutes" must never
 * turn out to be 3.4 when the user counts. Entry-level grants land under a
 * minute, so a whole-number result would read as zero.
 */
export function estimateVideoMinutes(
  credits: number,
  reference: CreditCapacityReference,
): number {
  if (reference.videoCreditsPerSecond <= 0) return 0
  const minutes = credits / (reference.videoCreditsPerSecond * 60)
  return Math.floor(minutes * 10) / 10
}
