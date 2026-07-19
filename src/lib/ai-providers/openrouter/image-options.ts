import type { DataContent, ProviderOptions } from '@ai-sdk/provider-utils'
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

export type ResolvedOpenRouterImageInput = {
  prompt: string | { images: DataContent[]; text: string }
  size: `${number}x${number}`
  quality: string
  outputFormat: string
  referenceImagesCount: number
  providerOptions: ProviderOptions
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

function assertAllowedOpenRouterImageOptions(options: OpenRouterImageOptions): void {
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

async function normalizeReferences(referenceImages: readonly string[]): Promise<DataContent[]> {
  if (referenceImages.length > MAX_REFERENCE_IMAGES) {
    throw new Error(`OPENROUTER_IMAGE_REFERENCE_LIMIT_EXCEEDED: ${referenceImages.length}`)
  }
  return await Promise.all(referenceImages.map(normalizeToBase64ForGeneration))
}

export async function resolveOpenRouterImageInput(input: {
  prompt: string
  options: OpenRouterImageOptions
}): Promise<ResolvedOpenRouterImageInput> {
  assertAllowedOpenRouterImageOptions(input.options)
  const promptText = input.prompt.trim()
  if (!promptText) throw new Error('OPENROUTER_IMAGE_PROMPT_REQUIRED')
  const resolution = resolveResolution(input.options)
  const aspectRatio = resolveAspectRatio(input.options)
  const quality = resolveQuality(input.options)
  const outputFormat = resolveOutputFormat(input.options)
  const background = resolveBackground(input.options)
  const outputCompression = resolveOutputCompression(input.options, outputFormat)
  const moderation = resolveModeration(input.options)
  const imageSize = resolveGptImage2ImageSize({ aspectRatio, resolution })
  const referenceImages = await normalizeReferences(input.options.referenceImages ?? [])

  return {
    prompt: referenceImages.length > 0
      ? { images: referenceImages, text: promptText }
      : promptText,
    size: `${imageSize.width}x${imageSize.height}`,
    quality,
    outputFormat,
    referenceImagesCount: referenceImages.length,
    providerOptions: {
      openrouter: {
        quality,
        output_format: outputFormat,
        ...(background ? { background } : {}),
        ...(outputCompression !== undefined ? { output_compression: outputCompression } : {}),
        provider: {
          only: ['openai'],
          allow_fallbacks: false,
          ...(moderation ? { options: { openai: { moderation } } } : {}),
        },
      },
    },
  }
}
