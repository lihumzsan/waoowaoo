import type { ImageGenerationRequest } from '@openrouter/sdk/models'
import { normalizeToBase64ForGeneration } from '@/lib/media/outbound-image'
import type { GptImage2NormalizedOptions } from '@/lib/ai-providers/shared/gpt-image-2'

export type OpenRouterImageOptions = GptImage2NormalizedOptions & {
  quality: string
  background?: string
  outputCompression?: number
  moderation?: string
}

async function normalizeReferences(referenceImages: readonly string[]): Promise<string[]> {
  return await Promise.all(referenceImages.map(normalizeToBase64ForGeneration))
}

export async function resolveOpenRouterImageInput(input: {
  prompt: string
  options: OpenRouterImageOptions
}) {
  const promptText = input.prompt.trim()
  if (!promptText) throw new Error('OPENROUTER_IMAGE_PROMPT_REQUIRED')
  const referenceImages = await normalizeReferences(input.options.referenceImages)
  const request = {
    prompt: promptText,
    n: 1,
    size: `${input.options.imageSize.width}x${input.options.imageSize.height}`,
    quality: input.options.quality as ImageGenerationRequest['quality'],
    outputFormat: input.options.outputFormat as ImageGenerationRequest['outputFormat'],
    ...(referenceImages.length > 0
      ? {
          inputReferences: referenceImages.map((url) => ({
            type: 'image_url' as const,
            imageUrl: { url },
          })),
        }
      : {}),
    ...(input.options.background
      ? { background: input.options.background as ImageGenerationRequest['background'] }
      : {}),
    ...(input.options.outputCompression !== undefined
      ? { outputCompression: input.options.outputCompression }
      : {}),
    provider: {
      only: ['openai'],
      allowFallbacks: false,
      ...(input.options.moderation
        ? { options: { openai: { moderation: input.options.moderation } } }
        : {}),
    },
  } satisfies Omit<ImageGenerationRequest, 'model' | 'stream'>

  return {
    request,
    size: request.size,
    quality: input.options.quality,
    outputFormat: input.options.outputFormat,
    referenceImagesCount: referenceImages.length,
  }
}
