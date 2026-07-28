import type {
  AiOptionObjectValidator,
  AiOptionSchema,
  AiOptionValidator,
  AiReadonlyUnknownObject,
  AiUnknownObject,
} from '@/lib/ai-registry/types'
import {
  buildMediaOptionSchema,
  enumValidator,
  stringArrayValidator,
} from '@/lib/ai-providers/shared/option-schema'

export const GPT_IMAGE_2_RESOLUTION_OPTIONS = ['1K', '2K', '4K'] as const
export const IMAGE_OUTPUT_FORMAT_OPTIONS = ['png', 'jpeg', 'webp'] as const

export type GptImage2Resolution = typeof GPT_IMAGE_2_RESOLUTION_OPTIONS[number]
export type GptImage2ImageSize = { width: number; height: number }
export type GptImage2NormalizedOptions = AiUnknownObject & {
  aspectRatio: string
  resolution: GptImage2Resolution
  quality?: string
  outputFormat: string
  referenceImages: string[]
  imageSize: GptImage2ImageSize
}

type GptImage2OptionPolicy = {
  resolutionOptions: readonly GptImage2Resolution[]
  aspectRatioOptions?: readonly string[]
  qualityOptions: readonly string[]
  defaultResolution: GptImage2Resolution
  defaultQuality?: string
  defaultOutputFormat: string
  maxReferenceImages?: number
  allowedKeys?: readonly string[]
  excludedKeys?: readonly string[]
  validators?: Readonly<Record<string, AiOptionValidator>>
  objectValidators?: readonly AiOptionObjectValidator[]
}

const GPT_IMAGE_2_MIN_PIXELS = 655_360
const GPT_IMAGE_2_MAX_PIXELS = 8_294_400
const GPT_IMAGE_2_MAX_EDGE = 3840
// 注意:这是对齐前的目标短边,不是最终输出。实际尺寸经 ceilToMultipleOf16 对齐
// (如 1K 短边实际输出 1088),不变量由 gpt-image-2-size-invariant 测试穷尽锁定。
const GPT_IMAGE_2_SHORT_EDGE_BY_RESOLUTION: Record<GptImage2Resolution, number> = {
  '1K': 1080,
  '2K': 1440,
  '4K': 2160,
}

function ceilToMultipleOf16(value: number): number {
  return Math.max(16, Math.ceil(value / 16) * 16)
}

function floorToMultipleOf16(value: number): number {
  return Math.max(16, Math.floor(value / 16) * 16)
}

function scaleImageSizeToMultipleOf16(
  imageSize: GptImage2ImageSize,
  scale: number,
  roundDimension: (value: number) => number,
): GptImage2ImageSize {
  return {
    width: roundDimension(imageSize.width * scale),
    height: roundDimension(imageSize.height * scale),
  }
}

function readAspectRatioValue(aspectRatio: string): number {
  const trimmed = aspectRatio.trim()
  const [rawWidth, rawHeight] = trimmed.split(':')
  if (!rawWidth || !rawHeight) {
    throw new Error(`GPT_IMAGE_2_OPTION_VALUE_UNSUPPORTED: aspectRatio=${aspectRatio}`)
  }
  const width = Number(rawWidth)
  const height = Number(rawHeight)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`GPT_IMAGE_2_OPTION_VALUE_UNSUPPORTED: aspectRatio=${aspectRatio}`)
  }
  const ratio = width / height
  if (ratio > 3 || ratio < 1 / 3) {
    throw new Error(`GPT_IMAGE_2_OPTION_VALUE_UNSUPPORTED: aspectRatio=${aspectRatio}`)
  }
  return ratio
}

function aspectRatioValidator(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, reason: 'expected_non_empty_aspect_ratio' } as const
  }
  try {
    readAspectRatioValue(value)
    return { ok: true } as const
  } catch {
    return { ok: false, reason: `unsupported_value=${value}` } as const
  }
}

function constrainGptImage2ImageSize(imageSize: GptImage2ImageSize): GptImage2ImageSize {
  let next = imageSize
  const maxEdge = Math.max(next.width, next.height)
  if (maxEdge > GPT_IMAGE_2_MAX_EDGE) {
    next = scaleImageSizeToMultipleOf16(next, GPT_IMAGE_2_MAX_EDGE / maxEdge, floorToMultipleOf16)
  }

  const pixels = next.width * next.height
  if (pixels > GPT_IMAGE_2_MAX_PIXELS) {
    next = scaleImageSizeToMultipleOf16(next, Math.sqrt(GPT_IMAGE_2_MAX_PIXELS / pixels), floorToMultipleOf16)
  }

  const constrainedPixels = next.width * next.height
  if (constrainedPixels < GPT_IMAGE_2_MIN_PIXELS) {
    next = scaleImageSizeToMultipleOf16(next, Math.sqrt(GPT_IMAGE_2_MIN_PIXELS / constrainedPixels), ceilToMultipleOf16)
  }

  return next
}

export function resolveGptImage2ImageSize(input: {
  aspectRatio: string
  resolution: GptImage2Resolution
}): GptImage2ImageSize {
  const ratio = readAspectRatioValue(input.aspectRatio)
  const shortEdge = GPT_IMAGE_2_SHORT_EDGE_BY_RESOLUTION[input.resolution]
  const rawSize = ratio >= 1
    ? { width: Math.round(shortEdge * ratio), height: shortEdge }
    : { width: shortEdge, height: Math.round(shortEdge / ratio) }
  const alignedSize = {
    width: ceilToMultipleOf16(rawSize.width),
    height: ceilToMultipleOf16(rawSize.height),
  }

  return constrainGptImage2ImageSize(alignedSize)
}

function normalizeGptImage2Options(
  options: AiReadonlyUnknownObject,
  policy: GptImage2OptionPolicy,
): GptImage2NormalizedOptions {
  const resolution = (options.size ?? options.resolution ?? policy.defaultResolution) as GptImage2Resolution
  const aspectRatio = options.aspectRatio as string
  const quality = (options.quality ?? policy.defaultQuality) as string | undefined
  const outputFormat = (options.outputFormat ?? policy.defaultOutputFormat) as string
  const referenceImages = (options.referenceImages ?? []) as string[]
  const normalized: AiUnknownObject = {
    ...options,
    aspectRatio,
    resolution,
    outputFormat,
    referenceImages,
    imageSize: resolveGptImage2ImageSize({ aspectRatio, resolution }),
    ...(quality ? { quality } : {}),
  }
  delete normalized.size
  return normalized as GptImage2NormalizedOptions
}

export function buildGptImage2OptionSchema(policy: GptImage2OptionPolicy): AiOptionSchema {
  return buildMediaOptionSchema('image', {
    allowedKeys: policy.allowedKeys,
    excludedKeys: policy.excludedKeys,
    required: ['aspectRatio'],
    conflicts: [{
      keys: ['size', 'resolution'],
      message: 'size_and_resolution_must_match',
      allowSameValue: true,
    }],
    validators: {
      size: enumValidator(policy.resolutionOptions),
      resolution: enumValidator(policy.resolutionOptions),
      aspectRatio: policy.aspectRatioOptions
        ? enumValidator(policy.aspectRatioOptions)
        : aspectRatioValidator,
      quality: enumValidator(policy.qualityOptions),
      outputFormat: enumValidator(IMAGE_OUTPUT_FORMAT_OPTIONS),
      referenceImages: stringArrayValidator({ maxLength: policy.maxReferenceImages }),
      ...policy.validators,
    },
    objectValidators: policy.objectValidators,
    normalize: (options) => normalizeGptImage2Options(options, policy),
  })
}
