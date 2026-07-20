import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { APICallError, generateImage as generateImageWithAiSdk, NoContentGeneratedError } from 'ai'
import { createScopedLogger } from '@/lib/logging/core'
import { getProviderConfig } from '@/lib/user-api/runtime-config'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import {
  decodeBase64WithLimit,
  MAX_BASE64_IMAGE_REQUEST_BYTES,
  MAX_IMAGE_BYTES,
  readResponseBufferWithLimit,
} from '@/lib/http/body-limits'
import { requireSelectedModelId } from '@/lib/ai-providers/shared/model-selection'
import type {
  AiProviderImageExecutionContext,
  GenerateResult,
} from '@/lib/ai-providers/runtime-types'
import {
  resolveOpenRouterImageInput,
  type OpenRouterImageOptions,
} from './image-options'
import { OPENROUTER_GPT_IMAGE_2_MODEL_ID } from './models'
import { ProviderPreAcceptRejectedError } from '@/lib/ai-exec/submission-error'

const OPENROUTER_IMAGE_TIMEOUT_MS = 5 * 60 * 1000

function requireOpenRouterBaseUrl(baseUrl: string | undefined): string {
  const normalized = typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/+$/, '') : ''
  if (!normalized) throw new Error('PROVIDER_BASE_URL_MISSING: openrouter (image)')
  return normalized
}

function resolveResponseMediaType(mediaTypeValue: string): string {
  const mediaType = mediaTypeValue.trim().toLowerCase()
  if (mediaType === 'image/png' || mediaType === 'image/jpeg' || mediaType === 'image/webp') {
    return mediaType
  }
  throw new Error(`OPENROUTER_IMAGE_RESPONSE_MEDIA_TYPE_UNSUPPORTED: ${mediaType}`)
}

function isProviderAccountHardLimit(error: unknown): boolean {
  if (!APICallError.isInstance(error) || error.statusCode !== 400 || !error.responseBody) return false
  try {
    const payload = JSON.parse(error.responseBody) as unknown
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
    const root = payload as Record<string, unknown>
    const detail = root.error
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return false
    const message = (detail as Record<string, unknown>).message
    if (typeof message !== 'string') return false
    return message.trim().toLowerCase() === 'billing hard limit has been reached.'
  } catch {
    return false
  }
}

async function fetchBoundedOpenRouterImageResponse(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetchWithProviderProxy(input, init)
  const buffer = await readResponseBufferWithLimit(
    response,
    MAX_BASE64_IMAGE_REQUEST_BYTES,
    'OpenRouter image response',
  )
  return new Response(buffer.toString('utf8'), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

export async function requestOpenRouterImage(input: {
  baseUrl: string
  apiKey: string
  modelId: string
  prompt: string
  options: OpenRouterImageOptions
}): Promise<GenerateResult> {
  if (!input.apiKey.trim()) throw new Error('OPENROUTER_API_KEY_REQUIRED')
  if (input.modelId !== OPENROUTER_GPT_IMAGE_2_MODEL_ID) {
    throw new Error(`OPENROUTER_IMAGE_MODEL_UNSUPPORTED: ${input.modelId}`)
  }
  const resolved = await resolveOpenRouterImageInput(input)
  const logger = createScopedLogger({
    module: 'worker.openrouter-image',
    action: 'openrouter_image_generate',
  })
  logger.info({
    message: 'OpenRouter image generation request',
    details: {
      modelId: input.modelId,
      size: resolved.size,
      quality: resolved.quality,
      outputFormat: resolved.outputFormat,
      referenceImagesCount: resolved.referenceImagesCount,
    },
  })

  const openRouter = createOpenRouter({
    apiKey: input.apiKey,
    baseURL: input.baseUrl,
    compatibility: 'strict',
    fetch: fetchBoundedOpenRouterImageResponse,
  })
  try {
    const result = await generateImageWithAiSdk({
      model: openRouter.imageModel(input.modelId),
      prompt: resolved.prompt,
      n: 1,
      size: resolved.size,
      providerOptions: resolved.providerOptions,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(OPENROUTER_IMAGE_TIMEOUT_MS),
    })
    const imageBase64 = result.image.base64
    decodeBase64WithLimit(imageBase64, MAX_IMAGE_BYTES, 'OpenRouter generated image')
    const mediaType = resolveResponseMediaType(result.image.mediaType)
    const hasUsage = Object.values(result.usage).some((value) => value !== undefined)
    return {
      success: true,
      imageBase64,
      imageUrl: `data:${mediaType};base64,${imageBase64}`,
      ...(hasUsage ? { metadata: { openRouterUsage: result.usage } } : {}),
    }
  } catch (error) {
    if (isProviderAccountHardLimit(error)) {
      throw new ProviderPreAcceptRejectedError(
        'provider_account_limit',
        'OpenRouter upstream provider account reached its billing hard limit before accepting the image request',
        { cause: error },
      )
    }
    if (NoContentGeneratedError.isInstance(error)) {
      throw new Error('OPENROUTER_IMAGE_RESPONSE_MISSING_IMAGE', { cause: error })
    }
    throw error
  }
}

export async function executeOpenRouterImageGeneration(
  input: AiProviderImageExecutionContext,
): Promise<GenerateResult> {
  const { apiKey, baseUrl } = await getProviderConfig(input.userId, input.selection.provider)
  const modelId = requireSelectedModelId(input.selection, 'openrouter:image')
  return await requestOpenRouterImage({
    baseUrl: requireOpenRouterBaseUrl(baseUrl),
    apiKey,
    modelId,
    prompt: input.prompt,
    options: input.options as OpenRouterImageOptions,
  })
}
