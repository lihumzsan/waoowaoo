import type { CapabilityValue } from '@/lib/ai-registry/types'

export interface ImageRuntimeGenerationOptions {
  readonly aspectRatio?: string
  readonly resolution?: string
  readonly quality?: string
  readonly size?: string
}

type ImageBillingMetadata = Record<string, unknown>

const IMAGE_SIZE_PATTERN = /^\d+x\d+$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isCapabilityValue(value: unknown): value is CapabilityValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

export function readImageRuntimeGenerationOptions(value: unknown): ImageRuntimeGenerationOptions {
  if (!isRecord(value)) return {}

  const aspectRatio = readString(value.aspectRatio)
  const resolution = readString(value.resolution)
  const quality = readString(value.quality)
  const size = readString(value.size)

  return {
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(resolution ? { resolution } : {}),
    ...(quality ? { quality } : {}),
    ...(size ? { size } : {}),
  }
}

export function requireImageRuntimeAspectRatio(value: unknown, context: string): string {
  const options = readImageRuntimeGenerationOptions(value)
  if (!options.aspectRatio) {
    throw new Error(`IMAGE_RUNTIME_ASPECT_RATIO_REQUIRED:${context}`)
  }
  return options.aspectRatio
}

export function buildImageRuntimeGenerationOptions(input: {
  readonly capabilityOptions: Record<string, CapabilityValue>
  readonly aspectRatio?: string | null
}): Record<string, CapabilityValue> {
  const options: Record<string, CapabilityValue> = {}
  for (const [field, value] of Object.entries(input.capabilityOptions)) {
    if (isCapabilityValue(value)) {
      options[field] = value
    }
  }

  const aspectRatio = readString(input.aspectRatio)
  if (aspectRatio) {
    options.aspectRatio = aspectRatio
  }

  return options
}

export function resolveImageSizeFromGenerationOptions(metadata?: ImageBillingMetadata): string | null {
  const explicitSize = readString(metadata?.imageSize) || readString(metadata?.size)
  if (explicitSize && IMAGE_SIZE_PATTERN.test(explicitSize)) return explicitSize

  const resolution = readString(metadata?.resolution)
  if (resolution && IMAGE_SIZE_PATTERN.test(resolution)) return resolution

  const aspectRatio = readString(metadata?.aspectRatio)
  if (!resolution || !aspectRatio) return null

  if (resolution === '1K') {
    if (aspectRatio === '1:1') return '1024x1024'
    if (aspectRatio === '4:3' || aspectRatio === '3:4') return '1024x768'
    if (aspectRatio === '3:2' || aspectRatio === '2:3' || aspectRatio === '9:16') return '1024x1536'
    if (aspectRatio === '16:9') return '1920x1080'
  }

  if (resolution === '2K' && aspectRatio === '16:9') return '2560x1440'
  if (resolution === '4K' && aspectRatio === '16:9') return '3840x2160'

  return null
}
