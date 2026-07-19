import { createScopedLogger } from '@/lib/logging/core'
import { getProviderConfig } from '@/lib/user-api/runtime-config'
import { fetchWithRetry, RETRY_POLICY } from '@/lib/retry'
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
  assertAllowedOpenRouterImageOptions,
  buildOpenRouterImageRequest,
  type OpenRouterImageOptions,
} from './image-protocol'
import { OPENROUTER_GPT_IMAGE_2_MODEL_ID } from './models'

const OPENROUTER_IMAGE_ENDPOINT_PATH = '/images'
const OPENROUTER_IMAGE_TIMEOUT_MS = 5 * 60 * 1000

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function requireOpenRouterBaseUrl(baseUrl: string | undefined): string {
  const normalized = typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/+$/, '') : ''
  if (!normalized) throw new Error('PROVIDER_BASE_URL_MISSING: openrouter (image)')
  return normalized
}

function resolveResponseMediaType(data: Record<string, unknown>, outputFormat: string): string {
  const mediaType = typeof data.media_type === 'string' ? data.media_type.trim().toLowerCase() : ''
  if (mediaType === 'image/png' || mediaType === 'image/jpeg' || mediaType === 'image/webp') {
    return mediaType
  }
  if (mediaType) throw new Error(`OPENROUTER_IMAGE_RESPONSE_MEDIA_TYPE_UNSUPPORTED: ${mediaType}`)
  if (outputFormat === 'jpeg') return 'image/jpeg'
  if (outputFormat === 'webp') return 'image/webp'
  return 'image/png'
}

async function readOpenRouterImageResponse(response: Response, outputFormat: string): Promise<GenerateResult> {
  const buffer = await readResponseBufferWithLimit(
    response,
    MAX_BASE64_IMAGE_REQUEST_BYTES,
    'OpenRouter image response',
  )
  let parsed: unknown
  try {
    parsed = JSON.parse(buffer.toString('utf8')) as unknown
  } catch {
    throw new Error('OPENROUTER_IMAGE_RESPONSE_INVALID_JSON')
  }
  const record = asRecord(parsed)
  const data = Array.isArray(record?.data) ? record.data : []
  const firstImage = asRecord(data[0])
  if (!firstImage) throw new Error('OPENROUTER_IMAGE_RESPONSE_MISSING_IMAGE')
  const imageBase64 = typeof firstImage?.b64_json === 'string' ? firstImage.b64_json.trim() : ''
  if (!imageBase64) throw new Error('OPENROUTER_IMAGE_RESPONSE_MISSING_IMAGE')
  decodeBase64WithLimit(imageBase64, MAX_IMAGE_BYTES, 'OpenRouter generated image')
  const mediaType = resolveResponseMediaType(firstImage, outputFormat)
  const usage = asRecord(record?.usage)

  return {
    success: true,
    imageBase64,
    imageUrl: `data:${mediaType};base64,${imageBase64}`,
    ...(usage ? { metadata: { openRouterUsage: usage } } : {}),
  }
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
  assertAllowedOpenRouterImageOptions(input.options)
  const payload = await buildOpenRouterImageRequest(input)
  const logger = createScopedLogger({
    module: 'worker.openrouter-image',
    action: 'openrouter_image_generate',
  })
  logger.info({
    message: 'OpenRouter image generation request',
    details: {
      modelId: input.modelId,
      size: payload.size,
      quality: payload.quality,
      outputFormat: payload.output_format,
      referenceImagesCount: payload.input_references?.length ?? 0,
    },
  })

  const response = await fetchWithRetry(`${input.baseUrl}${OPENROUTER_IMAGE_ENDPOINT_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify(payload),
    policy: RETRY_POLICY.providerSubmit,
    timeoutMs: OPENROUTER_IMAGE_TIMEOUT_MS,
    cache: 'no-store',
    scope: `openrouter:image:submit:${input.modelId}`,
    fetchFn: fetchWithProviderProxy,
  })
  return await readOpenRouterImageResponse(response, payload.output_format)
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
    options: input.options ?? {},
  })
}
