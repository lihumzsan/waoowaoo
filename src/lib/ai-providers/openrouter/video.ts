import { HTTPClient, OpenRouter } from '@openrouter/sdk'
import type { VideoGenerationRequest } from '@openrouter/sdk/models'
import { createScopedLogger } from '@/lib/logging/core'
import { getProviderConfig } from '@/lib/user-api/runtime-config'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import type {
  AiProviderVideoExecutionContext,
  GenerateResult,
} from '@/lib/ai-providers/runtime-types'
import { requireSelectedModelId } from '@/lib/ai-providers/shared/model-selection'
import {
  OPENROUTER_SEEDANCE_2_ASPECT_RATIO_OPTIONS,
  OPENROUTER_SEEDANCE_2_FAST_VIDEO_MODEL_ID,
  OPENROUTER_VIDEO_MODEL_IDS,
} from './models'

type OpenRouterVideoOptions = NonNullable<AiProviderVideoExecutionContext['options']>

type OpenRouterVideoRequest = VideoGenerationRequest

export type OpenRouterVideoPollResult = {
  status: 'pending' | 'completed' | 'failed'
  failureDisposition?: 'retryable' | 'permanent'
  videoUrl?: string
  resultUrl?: string
  downloadHeaders?: Record<string, string>
  error?: string
}

const OPENROUTER_VIDEO_REQUEST_TIMEOUT_MS = 60_000
const OPENROUTER_SEEDANCE_2_DURATIONS = new Set([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
const OPENROUTER_SEEDANCE_2_RESOLUTIONS = new Set(['480p', '720p', '1080p'])
const OPENROUTER_SEEDANCE_2_FAST_RESOLUTIONS = new Set(['480p', '720p'])
const OPENROUTER_SEEDANCE_2_ASPECT_RATIOS = new Set<string>(OPENROUTER_SEEDANCE_2_ASPECT_RATIO_OPTIONS)

function requireOpenRouterBaseUrl(baseUrl: string | undefined, context: string): string {
  const normalized = typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/+$/, '') : ''
  if (!normalized) {
    throw new Error(`PROVIDER_BASE_URL_MISSING: openrouter (${context})`)
  }
  return normalized
}

function normalizeMaybeRelativeUrl(value: string, baseUrl: string): string {
  const parsed = new URL(value, baseUrl)
  return parsed.toString()
}

function readCompletedVideoUrl(unsignedUrls: readonly string[] | undefined, baseUrl: string): string | null {
  const urls = Array.isArray(unsignedUrls) ? unsignedUrls : []
  const firstUrl = urls.find((url): url is string => typeof url === 'string' && url.trim().length > 0)
  if (!firstUrl) return null
  return normalizeMaybeRelativeUrl(firstUrl.trim(), baseUrl)
}

function buildDownloadHeaders(input: {
  resultUrl: string
  baseUrl: string
  apiKey: string
}): Record<string, string> | undefined {
  const result = new URL(input.resultUrl, input.baseUrl)
  const base = new URL(input.baseUrl)
  if (result.origin !== base.origin) return undefined
  return { Authorization: `Bearer ${input.apiKey}` }
}

function filterStringUrls(values: readonly string[] | undefined): string[] {
  if (!Array.isArray(values)) return []
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

function collectUniqueReferences(input: {
  imageUrl: string
  referenceImages?: readonly string[]
}): string[] {
  const imageUrl = input.imageUrl.trim()
  return Array.from(new Set([
    ...(imageUrl ? [imageUrl] : []),
    ...filterStringUrls(input.referenceImages),
  ]))
}

function assertAllowedOpenRouterVideoOptions(options: OpenRouterVideoOptions) {
  const allowedOptionKeys = new Set([
    'provider',
    'modelId',
    'modelKey',
    'duration',
    'resolution',
    'aspectRatio',
    'prompt',
    'generateAudio',
    'lastFrameImageUrl',
    'referenceImages',
  ])

  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue
    if (!allowedOptionKeys.has(key)) {
      throw new Error(`OPENROUTER_VIDEO_OPTION_UNSUPPORTED: ${key}`)
    }
  }
}

function assertSeedance2VideoOptions(options: OpenRouterVideoOptions, input: { fast: boolean }) {
  const resolutions = input.fast ? OPENROUTER_SEEDANCE_2_FAST_RESOLUTIONS : OPENROUTER_SEEDANCE_2_RESOLUTIONS
  if (options.resolution !== undefined && !resolutions.has(options.resolution)) {
    throw new Error(`OPENROUTER_VIDEO_OPTION_VALUE_UNSUPPORTED: resolution=${options.resolution}`)
  }
  if (options.duration !== undefined) {
    if (!Number.isInteger(options.duration) || !OPENROUTER_SEEDANCE_2_DURATIONS.has(options.duration)) {
      throw new Error(`OPENROUTER_VIDEO_OPTION_VALUE_UNSUPPORTED: duration=${options.duration}`)
    }
  }
  if (options.aspectRatio !== undefined && !OPENROUTER_SEEDANCE_2_ASPECT_RATIOS.has(options.aspectRatio)) {
    throw new Error(`OPENROUTER_VIDEO_OPTION_VALUE_UNSUPPORTED: aspectRatio=${options.aspectRatio}`)
  }
  if (options.lastFrameImageUrl !== undefined && !options.lastFrameImageUrl.trim()) {
    throw new Error('OPENROUTER_VIDEO_OPTION_VALUE_UNSUPPORTED: lastFrameImageUrl')
  }
}

function buildSharedVideoRequest(input: {
  modelId: string
  options: OpenRouterVideoOptions
}): OpenRouterVideoRequest {
  const prompt = typeof input.options.prompt === 'string' ? input.options.prompt.trim() : ''
  if (!prompt) throw new Error('OPENROUTER_VIDEO_PROMPT_REQUIRED')

  return {
    model: input.modelId,
    prompt,
    ...(typeof input.options.duration === 'number' ? { duration: input.options.duration } : {}),
    ...(input.options.resolution
      ? { resolution: input.options.resolution as NonNullable<VideoGenerationRequest['resolution']> }
      : {}),
    ...(input.options.aspectRatio
      ? { aspectRatio: input.options.aspectRatio as NonNullable<VideoGenerationRequest['aspectRatio']> }
      : {}),
    ...(typeof input.options.generateAudio === 'boolean' ? { generateAudio: input.options.generateAudio } : {}),
  }
}

function buildOpenRouterSeedance2Payload(input: {
  imageUrl: string
  modelId: string
  options: OpenRouterVideoOptions
}): OpenRouterVideoRequest {
  const shared = buildSharedVideoRequest({
    modelId: input.modelId,
    options: input.options,
  })
  const references = collectUniqueReferences({
    imageUrl: input.imageUrl,
    referenceImages: input.options.referenceImages,
  })

  if (input.options.lastFrameImageUrl) {
    const firstFrameUrl = references[0]
    if (!firstFrameUrl) {
      throw new Error('OPENROUTER_VIDEO_OPTION_VALUE_UNSUPPORTED: lastFrameImageUrl_without_imageUrl')
    }
    if (filterStringUrls(input.options.referenceImages).length > 0) {
      throw new Error('OPENROUTER_VIDEO_OPTION_UNSUPPORTED: referenceImages_with_lastFrameImageUrl')
    }
    return {
      ...shared,
      frameImages: [
        { type: 'image_url', frameType: 'first_frame', imageUrl: { url: firstFrameUrl } },
        { type: 'image_url', frameType: 'last_frame', imageUrl: { url: input.options.lastFrameImageUrl.trim() } },
      ],
    }
  }

  if (references.length > 1) {
    return {
      ...shared,
      inputReferences: references.map((url) => ({
        type: 'image_url',
        imageUrl: { url },
      })),
    }
  }

  if (references.length === 1) {
    const firstFrameUrl = references[0]
    if (!firstFrameUrl) throw new Error('OPENROUTER_VIDEO_REFERENCE_IMAGE_REQUIRED')
    return {
      ...shared,
      frameImages: [
        { type: 'image_url', frameType: 'first_frame', imageUrl: { url: firstFrameUrl } },
      ],
    }
  }

  return shared
}

async function fetchOpenRouterSdkRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (!(input instanceof Request)) {
    return await fetchWithProviderProxy(input, init)
  }
  const methodHasBody = input.method !== 'GET' && input.method !== 'HEAD'
  const body = methodHasBody ? await input.arrayBuffer() : undefined
  return await fetchWithProviderProxy(input.url, {
    method: input.method,
    headers: input.headers,
    ...(body && body.byteLength > 0 ? { body } : {}),
    signal: input.signal,
    cache: input.cache,
    ...init,
  })
}

function createOpenRouterVideoClient(input: { baseUrl: string; apiKey: string }): OpenRouter {
  return new OpenRouter({
    apiKey: input.apiKey,
    serverURL: input.baseUrl,
    httpClient: new HTTPClient({ fetcher: fetchOpenRouterSdkRequest }),
    retryConfig: { strategy: 'none' },
    timeoutMs: OPENROUTER_VIDEO_REQUEST_TIMEOUT_MS,
  })
}

export async function submitOpenRouterVideoTask(input: {
  baseUrl: string
  apiKey: string
  payload: OpenRouterVideoRequest
}): Promise<string> {
  if (!input.apiKey) {
    throw new Error('请配置 OpenRouter API Key')
  }

  const response = await createOpenRouterVideoClient(input).videoGeneration.generate(
    { videoGenerationRequest: input.payload },
    { retries: { strategy: 'none' }, cache: 'no-store' },
  )
  const requestId = response.id.trim()
  if (!requestId) throw new Error('OPENROUTER_VIDEO_SUBMIT_ID_MISSING')
  return requestId
}

export async function queryOpenRouterVideoStatus(input: {
  baseUrl: string
  apiKey: string
  requestId: string
}): Promise<OpenRouterVideoPollResult> {
  if (!input.apiKey) {
    throw new Error('请配置 OpenRouter API Key')
  }

  const response = await createOpenRouterVideoClient(input).videoGeneration.getGeneration(
    { jobId: input.requestId },
    { retries: { strategy: 'none' }, cache: 'no-store' },
  )
  const status = response.status
  if (status === 'pending' || status === 'in_progress') {
    return { status: 'pending' }
  }

  if (status === 'completed') {
    const videoUrl = readCompletedVideoUrl(response.unsignedUrls, input.baseUrl)
    if (!videoUrl) {
      return {
        status: 'failed',
        failureDisposition: 'retryable',
        error: 'OPENROUTER_VIDEO_COMPLETED_WITHOUT_URL',
      }
    }
    return {
      status: 'completed',
      videoUrl,
      resultUrl: videoUrl,
      downloadHeaders: buildDownloadHeaders({
        resultUrl: videoUrl,
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
      }),
    }
  }

  if (status === 'failed' || status === 'cancelled' || status === 'canceled' || status === 'expired') {
    return {
      status: 'failed',
      failureDisposition: 'retryable',
      error: response.error?.trim() || `OpenRouter video generation ${status}`,
    }
  }

  throw new Error(`OPENROUTER_VIDEO_STATUS_UNKNOWN:${status}`)
}

export async function executeOpenRouterVideoGeneration(input: AiProviderVideoExecutionContext): Promise<GenerateResult> {
  const { apiKey, baseUrl } = await getProviderConfig(input.userId, input.selection.provider)
  const normalizedBaseUrl = requireOpenRouterBaseUrl(baseUrl, 'video')
  const modelId = requireSelectedModelId(input.selection, 'openrouter:video')
  if (!OPENROUTER_VIDEO_MODEL_IDS.has(modelId)) {
    throw new Error(`OPENROUTER_VIDEO_MODEL_UNSUPPORTED: ${modelId}`)
  }

  const options: OpenRouterVideoOptions = input.options ?? {}
  assertAllowedOpenRouterVideoOptions(options)
  assertSeedance2VideoOptions(options, {
    fast: modelId === OPENROUTER_SEEDANCE_2_FAST_VIDEO_MODEL_ID,
  })

  const payload = buildOpenRouterSeedance2Payload({
    imageUrl: input.imageUrl,
    modelId,
    options,
  })

  const logger = createScopedLogger({ module: 'worker.openrouter-video', action: 'openrouter_video_generate' })
  logger.info({ message: 'OpenRouter video generation request', details: { modelId } })

  const requestId = await submitOpenRouterVideoTask({
    baseUrl: normalizedBaseUrl,
    apiKey,
    payload,
  })
  logger.info({ message: 'OpenRouter video task submitted', details: { requestId } })

  return {
    success: true,
    async: true,
    requestId,
    endpoint: 'videos',
    externalId: `OPENROUTER:VIDEO:${requestId}`,
  }
}
