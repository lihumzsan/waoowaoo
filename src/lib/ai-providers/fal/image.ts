import { createScopedLogger } from '@/lib/logging/core'
import { getProviderConfig } from '@/lib/user-api/runtime-config'
import { normalizeToBase64ForGeneration } from '@/lib/media/outbound-image'
import { buildFalQueueUrl } from '@/lib/ai-providers/fal/base-url'
import { fetchWithRetry, RETRY_POLICY } from '@/lib/retry'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import { requireSelectedModelId } from '@/lib/ai-providers/shared/model-selection'
import { FAL_GPT_IMAGE_2_MODEL_ID } from '@/lib/ai-providers/fal/models'
import type {
  GptImage2ImageSize,
  GptImage2NormalizedOptions,
} from '@/lib/ai-providers/shared/gpt-image-2'
import type { AiProviderImageExecutionContext, GenerateResult } from '@/lib/ai-providers/runtime-types'

type FalImageOptions = NonNullable<AiProviderImageExecutionContext['options']> & {
  outputFormat: string
  referenceImages: string[]
}
type FalGptImage2Options = FalImageOptions & GptImage2NormalizedOptions

type FalImageSubmitBody = {
  prompt: string
  num_images: number
  output_format: string
  aspect_ratio?: string
  resolution?: string
  image_size?: GptImage2ImageSize
  quality?: string
  image_urls?: string[]
}

const FAL_IMAGE_ENDPOINTS: Record<string, { base: string; edit: string }> = {
  banana: { base: 'fal-ai/nano-banana-pro', edit: 'fal-ai/nano-banana-pro/edit' },
  'banana-2': { base: 'fal-ai/nano-banana-2', edit: 'fal-ai/nano-banana-2/edit' },
  [FAL_GPT_IMAGE_2_MODEL_ID]: {
    base: `openai/${FAL_GPT_IMAGE_2_MODEL_ID}`,
    edit: `openai/${FAL_GPT_IMAGE_2_MODEL_ID}/edit`,
  },
}

function buildFalImageSubmitBody(input: {
  modelId: string
  prompt: string
  options: FalImageOptions
  outputFormat: string
}): FalImageSubmitBody {
  const body: FalImageSubmitBody = {
    prompt: input.prompt,
    num_images: 1,
    output_format: input.outputFormat,
  }

  if (input.modelId === FAL_GPT_IMAGE_2_MODEL_ID) {
    const options = input.options as FalGptImage2Options
    body.image_size = options.imageSize
    if (options.quality) body.quality = options.quality
    return body
  }

  if (input.options.aspectRatio) body.aspect_ratio = input.options.aspectRatio
  if (input.options.resolution) body.resolution = input.options.resolution
  return body
}

export async function executeFalImageGeneration(input: AiProviderImageExecutionContext): Promise<GenerateResult> {
  const { apiKey } = await getProviderConfig(input.userId, input.selection.provider)

  const options = input.options as FalImageOptions
  const referenceImages = options.referenceImages

  const aspectRatio = options.aspectRatio
  const resolution = options.resolution
  const outputFormat = options.outputFormat
  const modelId = requireSelectedModelId(input.selection, 'fal:image')

  const hasReferenceImages = referenceImages.length > 0
  const endpointConfig = FAL_IMAGE_ENDPOINTS[modelId]
  if (!endpointConfig) {
    throw new Error(`FAL_IMAGE_MODEL_UNSUPPORTED: ${modelId}`)
  }
  const endpoint = hasReferenceImages ? endpointConfig.edit : endpointConfig.base

  const logger = createScopedLogger({ module: 'worker.fal-image', action: 'fal_image_generate' })
  logger.info({
    message: 'FAL image generation request',
    details: {
      modelId,
      endpoint,
      referenceImagesCount: referenceImages.length,
      hasReferenceImages,
      resolution: resolution ?? null,
      aspectRatio: aspectRatio ?? null,
      referenceImageUrls: referenceImages.map((u) => u.substring(0, 100)),
    },
  })

  const body = buildFalImageSubmitBody({
    modelId,
    prompt: input.prompt,
    options,
    outputFormat,
  })

  if (hasReferenceImages) {
    const dataUrls = await Promise.all(
      referenceImages.map(async (url) => (url.startsWith('data:') ? url : await normalizeToBase64ForGeneration(url))),
    )
    body.image_urls = dataUrls
    logger.info({
      message: 'FAL image reference images converted',
      details: {
        count: referenceImages.length,
        sizes: dataUrls.map((d) => `${Math.round(d.length / 1024)}KB`),
      },
    })
  }

  const submitResponse = await fetchWithRetry(buildFalQueueUrl(endpoint), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Key ${apiKey}`,
    },
    body: JSON.stringify(body),
    policy: RETRY_POLICY.providerSubmit,
    cache: 'no-store',
    scope: `fal:image:submit:${endpoint}`,
    fetchFn: fetchWithProviderProxy,
  })

  const submitData = (await submitResponse.json()) as { request_id?: unknown }
  const requestId = typeof submitData.request_id === 'string' ? submitData.request_id : ''
  if (!requestId) {
    throw new Error('FAL 未返回 request_id')
  }

  return {
    success: true,
    async: true,
    requestId,
    endpoint,
    externalId: `FAL:IMAGE:${endpoint}:${requestId}`,
  }
}
