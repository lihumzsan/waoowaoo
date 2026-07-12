import { createScopedLogger } from '@/lib/logging/core'
import { getProviderConfig } from '@/lib/user-api/runtime-config'
import { FetchStatusError, fetchWithRetry, RETRY_POLICY } from '@/lib/retry'
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

type OpenRouterFrameType = 'first_frame' | 'last_frame'

type OpenRouterFrameImage = {
  type: 'image_url'
  image_url: { url: string }
  frame_type: OpenRouterFrameType
}

type OpenRouterInputReference = {
  type: 'image_url'
  image_url: { url: string }
}

type OpenRouterVideoRequest = {
  model: string
  prompt: string
  duration?: number
  resolution?: string
  aspect_ratio?: string
  generate_audio?: boolean
  frame_images?: OpenRouterFrameImage[]
  input_references?: OpenRouterInputReference[]
}

type OpenRouterSubmitResponse = {
  id?: unknown
  status?: unknown
  polling_url?: unknown
}

type OpenRouterStatusResponse = {
  id?: unknown
  status?: unknown
  unsigned_urls?: unknown
  error?: unknown
  message?: unknown
}

export type OpenRouterVideoPollResult = {
  status: 'pending' | 'completed' | 'failed'
  failureDisposition?: 'retryable' | 'permanent'
  videoUrl?: string
  resultUrl?: string
  downloadHeaders?: Record<string, string>
  error?: string
}

const OPENROUTER_VIDEO_ENDPOINT_PATH = '/videos'
const OPENROUTER_SEEDANCE_2_DURATIONS = new Set([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
const OPENROUTER_SEEDANCE_2_RESOLUTIONS = new Set(['480p', '720p', '1080p'])
const OPENROUTER_SEEDANCE_2_FAST_RESOLUTIONS = new Set(['480p', '720p'])
const OPENROUTER_SEEDANCE_2_ASPECT_RATIOS = new Set<string>(OPENROUTER_SEEDANCE_2_ASPECT_RATIO_OPTIONS)

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text.trim()) return null
  return JSON.parse(text) as unknown
}

async function readErrorText(response: Response): Promise<string> {
  const text = await response.text()
  return text.trim() || response.statusText || 'empty response'
}

function requireOpenRouterBaseUrl(baseUrl: string | undefined, context: string): string {
  const normalized = typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/+$/, '') : ''
  if (!normalized) {
    throw new Error(`PROVIDER_BASE_URL_MISSING: openrouter (${context})`)
  }
  return normalized
}

function buildOpenRouterUrl(baseUrl: string, path: string): string {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '')
  return `${normalizedBaseUrl}${path.startsWith('/') ? path : `/${path}`}`
}

function normalizeMaybeRelativeUrl(value: string, baseUrl: string): string {
  const parsed = new URL(value, baseUrl)
  return parsed.toString()
}

function readProviderError(data: unknown): string | null {
  const record = asRecord(data)
  if (!record) return null

  const error = record.error
  if (typeof error === 'string' && error.trim()) return error.trim()

  const errorRecord = asRecord(error)
  if (typeof errorRecord?.message === 'string' && errorRecord.message.trim()) {
    return errorRecord.message.trim()
  }

  const message = record.message
  if (typeof message === 'string' && message.trim()) return message.trim()

  return null
}

function readSubmitId(data: unknown): string {
  const response = data as OpenRouterSubmitResponse | null
  const id = typeof response?.id === 'string' ? response.id.trim() : ''
  if (!id) throw new Error('OPENROUTER_VIDEO_SUBMIT_ID_MISSING')
  return id
}

function readCompletedVideoUrl(data: unknown, baseUrl: string): string | null {
  const response = data as OpenRouterStatusResponse | null
  const urls = Array.isArray(response?.unsigned_urls) ? response.unsigned_urls : []
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
    ...(input.options.resolution ? { resolution: input.options.resolution } : {}),
    ...(input.options.aspectRatio ? { aspect_ratio: input.options.aspectRatio } : {}),
    ...(typeof input.options.generateAudio === 'boolean' ? { generate_audio: input.options.generateAudio } : {}),
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
      frame_images: [
        { type: 'image_url', frame_type: 'first_frame', image_url: { url: firstFrameUrl } },
        { type: 'image_url', frame_type: 'last_frame', image_url: { url: input.options.lastFrameImageUrl.trim() } },
      ],
    }
  }

  if (references.length > 1) {
    return {
      ...shared,
      input_references: references.map((url) => ({
        type: 'image_url',
        image_url: { url },
      })),
    }
  }

  if (references.length === 1) {
    const firstFrameUrl = references[0]
    if (!firstFrameUrl) throw new Error('OPENROUTER_VIDEO_REFERENCE_IMAGE_REQUIRED')
    return {
      ...shared,
      frame_images: [
        { type: 'image_url', frame_type: 'first_frame', image_url: { url: firstFrameUrl } },
      ],
    }
  }

  return shared
}

export async function submitOpenRouterVideoTask(input: {
  baseUrl: string
  apiKey: string
  payload: OpenRouterVideoRequest
}): Promise<string> {
  if (!input.apiKey) {
    throw new Error('请配置 OpenRouter API Key')
  }

  const response = await fetchWithRetry(buildOpenRouterUrl(input.baseUrl, OPENROUTER_VIDEO_ENDPOINT_PATH), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify(input.payload),
    policy: RETRY_POLICY.providerSubmit,
    cache: 'no-store',
    scope: `openrouter:video:submit:${input.payload.model}`,
    fetchFn: fetchWithProviderProxy,
  })

  return readSubmitId(await readJson(response))
}

export async function queryOpenRouterVideoStatus(input: {
  baseUrl: string
  apiKey: string
  requestId: string
}): Promise<OpenRouterVideoPollResult> {
  if (!input.apiKey) {
    throw new Error('请配置 OpenRouter API Key')
  }

  const response = await fetchWithProviderProxy(
    buildOpenRouterUrl(input.baseUrl, `${OPENROUTER_VIDEO_ENDPOINT_PATH}/${encodeURIComponent(input.requestId)}`),
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
      },
      cache: 'no-store',
    },
  )
  const data = response.ok ? await readJson(response) : null
  if (!response.ok) {
    const errorText = await readErrorText(response)
    throw new FetchStatusError(response.status, errorText)
  }

  const statusResponse = data as OpenRouterStatusResponse | null
  const status = typeof statusResponse?.status === 'string' ? statusResponse.status : ''
  if (status === 'pending' || status === 'in_progress') {
    return { status: 'pending' }
  }

  if (status === 'completed') {
    const videoUrl = readCompletedVideoUrl(data, input.baseUrl)
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
      error: readProviderError(data) || `OpenRouter video generation ${status}`,
    }
  }

  throw new Error(`OPENROUTER_VIDEO_STATUS_UNKNOWN:${status || 'missing'}`)
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
