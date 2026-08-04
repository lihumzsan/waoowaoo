import { calcImage, calcVideo } from './cost'
import { toChargeableCredits } from './credits'
import { FAL_GPT_IMAGE_2_MODEL_ID } from '@/lib/ai-providers/fal/models'
import { OPENROUTER_SEEDANCE_2_VIDEO_MODEL_ID } from '@/lib/ai-providers/openrouter/models'

/**
 * What a credit balance actually buys.
 *
 * A number of credits means nothing on its own — nobody knows whether 5,600 is
 * a lot. These reference figures answer the question people actually have when
 * comparing plans: how many pictures, how many clips.
 *
 * They are computed from the same retail catalog that charges for the work, so
 * a price change moves the pricing page's claims with it rather than leaving
 * them to drift into fiction.
 */

/** A representative image: GPT Image 2 at 1K, high quality. */
const REFERENCE_IMAGE = {
  model: `fal::${FAL_GPT_IMAGE_2_MODEL_ID}`,
  metadata: { imageSize: '1024x1024', quality: 'high' },
} as const

/** A representative clip: Seedance 2.0, 720p, ten seconds. */
const REFERENCE_VIDEO = {
  model: `openrouter::${OPENROUTER_SEEDANCE_2_VIDEO_MODEL_ID}`,
  resolution: '720p',
  durationSeconds: 10,
} as const

export interface CreditCapacityReference {
  /** Credits for one representative image. */
  readonly imageCredits: number
  /** Credits for one representative clip. */
  readonly videoCredits: number
  readonly videoDurationSeconds: number
  readonly videoResolution: string
}

export function resolveCreditCapacityReference(): CreditCapacityReference {
  return {
    imageCredits: toChargeableCredits(
      calcImage(REFERENCE_IMAGE.model, 1, { ...REFERENCE_IMAGE.metadata }),
    ),
    videoCredits: toChargeableCredits(
      calcVideo(REFERENCE_VIDEO.model, REFERENCE_VIDEO.resolution, 1, {
        duration: REFERENCE_VIDEO.durationSeconds,
      }),
    ),
    videoDurationSeconds: REFERENCE_VIDEO.durationSeconds,
    videoResolution: REFERENCE_VIDEO.resolution,
  }
}

export interface CreditCapacityEstimate {
  readonly images: number
  readonly videos: number
}

/**
 * How much work a credit amount covers, if spent entirely on one kind.
 *
 * Rounded down, because "about 180 images" must never turn out to be 179 when
 * the user counts.
 */
export function estimateCreditCapacity(
  credits: number,
  reference: CreditCapacityReference,
): CreditCapacityEstimate {
  return {
    images: reference.imageCredits > 0 ? Math.floor(credits / reference.imageCredits) : 0,
    videos: reference.videoCredits > 0 ? Math.floor(credits / reference.videoCredits) : 0,
  }
}
