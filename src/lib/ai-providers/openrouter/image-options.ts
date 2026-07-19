import type { DataContent } from 'ai'
import { normalizeToBase64ForGeneration } from '@/lib/media/outbound-image'
import type { GptImage2NormalizedOptions } from '@/lib/ai-providers/shared/gpt-image-2'

export type OpenRouterImageOptions = GptImage2NormalizedOptions & {
  quality: string
  background?: string
  outputCompression?: number
  moderation?: string
}

async function normalizeReferences(referenceImages: readonly string[]): Promise<DataContent[]> {
  return await Promise.all(referenceImages.map(normalizeToBase64ForGeneration))
}

export async function resolveOpenRouterImageInput(input: {
  prompt: string
  options: OpenRouterImageOptions
}) {
  const promptText = input.prompt.trim()
  if (!promptText) throw new Error('OPENROUTER_IMAGE_PROMPT_REQUIRED')
  const referenceImages = await normalizeReferences(input.options.referenceImages)

  return {
    prompt: referenceImages.length > 0
      ? { images: referenceImages, text: promptText }
      : promptText,
    size: `${input.options.imageSize.width}x${input.options.imageSize.height}` as `${number}x${number}`,
    quality: input.options.quality,
    outputFormat: input.options.outputFormat,
    referenceImagesCount: referenceImages.length,
    providerOptions: {
      openrouter: {
        quality: input.options.quality,
        output_format: input.options.outputFormat,
        ...(input.options.background ? { background: input.options.background } : {}),
        ...(input.options.outputCompression !== undefined
          ? { output_compression: input.options.outputCompression }
          : {}),
        provider: {
          only: ['openai'],
          allow_fallbacks: false,
          ...(input.options.moderation
            ? { options: { openai: { moderation: input.options.moderation } } }
            : {}),
        },
      },
    },
  }
}
