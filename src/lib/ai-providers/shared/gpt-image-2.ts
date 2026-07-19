export const GPT_IMAGE_2_RESOLUTION_OPTIONS = ['1K', '2K', '4K'] as const

export type GptImage2Resolution = typeof GPT_IMAGE_2_RESOLUTION_OPTIONS[number]
export type GptImage2ImageSize = { width: number; height: number }

const GPT_IMAGE_2_MIN_PIXELS = 655_360
const GPT_IMAGE_2_MAX_PIXELS = 8_294_400
const GPT_IMAGE_2_MAX_EDGE = 3840
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

  return constrainGptImage2ImageSize(rawSize)
}
