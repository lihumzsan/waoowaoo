import { normalizeToBase64ForGeneration } from '@/lib/media/outbound-image'
import {
  resolveGptImage2ImageSize,
  type GptImage2Resolution,
} from '@/lib/ai-providers/shared/gpt-image-2'
import type { AiProviderImageExecutionContext } from '@/lib/ai-providers/runtime-types'
import {
  OPENROUTER_GPT_IMAGE_2_ASPECT_RATIO_OPTIONS,
  OPENROUTER_GPT_IMAGE_2_QUALITY_OPTIONS,
  OPENROUTER_GPT_IMAGE_2_RESOLUTION_OPTIONS,
} from './models'

export type OpenRouterImageOptions = NonNullable<AiProviderImageExecutionContext['options']>

type OpenRouterInputReference = {
  type: 'image_url'
  image_url: { url: string }
}

export type OpenRouterImageRequest = {
  model: string
  prompt: string
  n: 1
  size: string
  quality: string
  output_format: string
  input_references?: OpenRouterInputReference[]
  background?: string
  output_compression?: number
  provider: {
    only: ['openai']
    allow_fallbacks: false
    options?: { openai: { moderation: string } }
  }
}

const MAX_REFERENCE_IMAGES = 16
const RESOLUTIONS = new Set<string>(OPENROUTER_GPT_IMAGE_2_RESOLUTION_OPTIONS)
const ASPECT_RATIOS = new Set<string>(OPENROUTER_GPT_IMAGE_2_ASPECT_RATIO_OPTIONS)
const QUALITIES = new Set<string>(OPENROUTER_GPT_IMAGE_2_QUALITY_OPTIONS)
const OUTPUT_FORMATS = new Set(['png', 'jpeg', 'webp'])
const BACKGROUNDS = new Set(['auto', 'opaque'])
const MODERATION_OPTIONS = new Set(['auto', 'low'])

function readOptionalString(value: unknown, optionName: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`OPENROUTER_IMAGE_OPTION_INVALID: ${optionName}`)
  }
  return value.trim()
}

export function assertAllowedOpenRouterImageOptions(options: OpenRouterImageOptions): void {
  const allowedOptionKeys = new Set([
    'provider',
    'modelId',
    'modelKey',
    'aspectRatio',
    'resolution',
    'size',
    'quality',
    'outputFormat',
    'referenceImages',
    'background',
    'outputCompression',
    'moderation',
  ])
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && !allowedOptionKeys.has(key)) {
      throw new Error(`OPENROUTER_IMAGE_OPTION_UNSUPPORTED: ${key}`)
    }
  }
}

function resolveResolution(options: OpenRouterImageOptions): GptImage2Resolution {
  const size = readOptionalString(options.size, 'size')
  const resolution = readOptionalString(options.resolution, 'resolution')
  if (size && resolution && size !== resolution) {
    throw new Error('OPENROUTER_IMAGE_OPTION_CONFLICT: size and resolution must match')
  }
  const selected = size || resolution || '1K'
  if (!RESOLUTIONS.has(selected)) {
    throw new Error(`OPENROUTER_IMAGE_OPTION_VALUE_UNSUPPORTED: resolution=${selected}`)
  }
  return selected as GptImage2Resolution
}

function resolveAspectRatio(options: OpenRouterImageOptions): string {
  const aspectRatio = readOptionalString(options.aspectRatio, 'aspectRatio')
  if (!aspectRatio) throw new Error('OPENROUTER_IMAGE_OPTION_REQUIRED: aspectRatio')
  if (!ASPECT_RATIOS.has(aspectRatio)) {
    throw new Error(`OPENROUTER_IMAGE_OPTION_VALUE_UNSUPPORTED: aspectRatio=${aspectRatio}`)
  }
  return aspectRatio
}

function resolveQuality(options: OpenRouterImageOptions): string {
  const quality = readOptionalString(options.quality, 'quality') ?? 'high'
  if (!QUALITIES.has(quality)) {
    throw new Error(`OPENROUTER_IMAGE_OPTION_VALUE_UNSUPPORTED: quality=${quality}`)
  }
  return quality
}

function resolveOutputFormat(options: OpenRouterImageOptions): string {
  const outputFormat = readOptionalString(options.outputFormat, 'outputFormat') ?? 'png'
  if (!OUTPUT_FORMATS.has(outputFormat)) {
    throw new Error(`OPENROUTER_IMAGE_OPTION_VALUE_UNSUPPORTED: outputFormat=${outputFormat}`)
  }
  return outputFormat
}

function resolveBackground(options: OpenRouterImageOptions): string | undefined {
  const background = readOptionalString(options.background, 'background')
  if (background && !BACKGROUNDS.has(background)) {
    throw new Error(`OPENROUTER_IMAGE_OPTION_VALUE_UNSUPPORTED: background=${background}`)
  }
  return background
}

function resolveOutputCompression(options: OpenRouterImageOptions, outputFormat: string): number | undefined {
  const outputCompression = options.outputCompression
  if (outputCompression === undefined) return undefined
  if (!Number.isInteger(outputCompression) || outputCompression < 0 || outputCompression > 100) {
    throw new Error(`OPENROUTER_IMAGE_OPTION_VALUE_UNSUPPORTED: outputCompression=${String(outputCompression)}`)
  }
  if (outputFormat === 'png') {
    throw new Error('OPENROUTER_IMAGE_OPTION_CONFLICT: outputCompression requires jpeg or webp')
  }
  return outputCompression
}

function resolveModeration(options: OpenRouterImageOptions): string | undefined {
  const moderation = readOptionalString(options.moderation, 'moderation')
  if (moderation && !MODERATION_OPTIONS.has(moderation)) {
    throw new Error(`OPENROUTER_IMAGE_OPTION_VALUE_UNSUPPORTED: moderation=${moderation}`)
  }
  return moderation
}

async function normalizeReferences(referenceImages: readonly string[]): Promise<OpenRouterInputReference[]> {
  if (referenceImages.length > MAX_REFERENCE_IMAGES) {
    throw new Error(`OPENROUTER_IMAGE_REFERENCE_LIMIT_EXCEEDED: ${referenceImages.length}`)
  }
  return await Promise.all(referenceImages.map(async (image) => ({
    type: 'image_url' as const,
    image_url: { url: await normalizeToBase64ForGeneration(image) },
  })))
}

export async function buildOpenRouterImageRequest(input: {
  modelId: string
  prompt: string
  options: OpenRouterImageOptions
}): Promise<OpenRouterImageRequest> {
  const prompt = input.prompt.trim()
  if (!prompt) throw new Error('OPENROUTER_IMAGE_PROMPT_REQUIRED')
  const resolution = resolveResolution(input.options)
  const aspectRatio = resolveAspectRatio(input.options)
  const quality = resolveQuality(input.options)
  const outputFormat = resolveOutputFormat(input.options)
  const background = resolveBackground(input.options)
  const outputCompression = resolveOutputCompression(input.options, outputFormat)
  const moderation = resolveModeration(input.options)
  const imageSize = resolveGptImage2ImageSize({ aspectRatio, resolution })
  const inputReferences = await normalizeReferences(input.options.referenceImages ?? [])

  return {
    model: input.modelId,
    prompt,
    n: 1,
    size: `${imageSize.width}x${imageSize.height}`,
    quality,
    output_format: outputFormat,
    ...(inputReferences.length > 0 ? { input_references: inputReferences } : {}),
    ...(background ? { background } : {}),
    ...(outputCompression !== undefined ? { output_compression: outputCompression } : {}),
    provider: {
      only: ['openai'],
      allow_fallbacks: false,
      ...(moderation ? { options: { openai: { moderation } } } : {}),
    },
  }
}
