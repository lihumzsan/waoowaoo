import { AppError } from '@/lib/errors/app-error'
import {
  videoCompositionSchema,
  type VideoComposition,
  type VideoClip,
  type CharacterNameLayer,
} from './composition-contract'

export type ResolvedCompositionTiming = {
  /** Authored clock: retained for native editing and source-audio intervals. */
  readonly durationMs: number
  readonly frameRate: string
  /** Discrete video clock, projected from absolute authored endpoints once. */
  readonly videoFrameCount: number
  readonly videoDurationUs: number
  readonly clips: readonly (VideoClip & {
    readonly targetStartMs: number
    readonly videoFrameCount: number
  })[]
  readonly textLayers: readonly (CharacterNameLayer & {
    readonly targetStartMs: number
  })[]
}

function safeNumber(value: bigint): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result))
    throw new AppError('COMPOSITION_INPUT_INVALID')
  return result
}

function roundRatio(numerator: bigint, denominator: bigint): bigint {
  return (BigInt(2) * numerator + denominator) / (BigInt(2) * denominator)
}

/** One authored timeline; output frames are a projection, never an encoder observation. */
export function resolveCompositionTiming(
  value: VideoComposition,
  frameRate: string,
): ResolvedCompositionTiming {
  const composition = videoCompositionSchema.parse(value)
  const match = /^([1-9]\d*)\/([1-9]\d*)$/u.exec(frameRate)
  const numerator = Number(match?.[1])
  const denominator = Number(match?.[2])
  if (
    !match ||
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    numerator / denominator < 1 ||
    numerator / denominator > 120
  ) {
    throw new AppError('COMPOSITION_INPUT_INVALID', undefined, {
      details: { reasonCode: 'FRAME_RATE_INVALID' },
    })
  }
  const fpsNumerator = BigInt(numerator)
  const fpsDenominator = BigInt(denominator)
  const frameAt = (ms: number) =>
    safeNumber(
      roundRatio(BigInt(ms) * fpsNumerator, BigInt(1000) * fpsDenominator),
    )
  let durationMs = 0
  let endFrame = 0
  const starts = new Map<string, number>()
  const clips = composition.clips.map((clip) => {
    const targetStartMs = durationMs
    const startFrame = endFrame
    starts.set(clip.clipId, targetStartMs)
    durationMs += clip.durationMs
    if (!Number.isSafeInteger(durationMs))
      throw new AppError('COMPOSITION_INPUT_INVALID')
    endFrame = frameAt(durationMs)
    const videoFrameCount = endFrame - startFrame
    if (videoFrameCount <= 0) {
      throw new AppError('COMPOSITION_INPUT_INVALID', undefined, {
        details: {
          reasonCode: 'CLIP_HAS_NO_OUTPUT_FRAME',
          clipId: clip.clipId,
          frameRate,
        },
      })
    }
    return { ...clip, targetStartMs, videoFrameCount }
  })
  return {
    durationMs,
    frameRate,
    videoFrameCount: endFrame,
    videoDurationUs: safeNumber(
      roundRatio(
        BigInt(endFrame) * fpsDenominator * BigInt(1000000),
        fpsNumerator,
      ),
    ),
    clips,
    textLayers: composition.textLayers.map((layer) => {
      const start = starts.get(layer.clipId)
      if (start === undefined) throw new AppError('COMPOSITION_INPUT_INVALID')
      return { ...layer, targetStartMs: start + layer.startOffsetMs }
    }),
  }
}
