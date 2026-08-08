import { AppError } from '@/lib/errors/app-error'
import { EXTERNAL_OPERATION } from '@/lib/external-operation/registry'
import { createProviderAsyncTaskFailure } from '@/lib/ai-providers/shared/async-task-status'
import { ProviderSubmissionError } from '@/lib/ai-exec/submission-error'
import type {
  AiProviderVideoExecutionContext,
  GenerateResult,
} from '@/lib/ai-providers/runtime-types'
import { requireSelectedModelId } from '@/lib/ai-providers/shared/model-selection'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import {
  FetchStatusError,
  fetchWithRetry,
} from '@/lib/retry'
import { getProviderConfig } from '@/lib/user-api/runtime-config'
import { getErrorSpec, type UnifiedErrorCode } from '@/lib/errors/codes'
import { createScopedLogger } from '@/lib/logging/core'
import {
  TOONFLOW_SEEDANCE_2_FAST_MODEL_ID,
  TOONFLOW_SEEDANCE_2_FAST_WIRE_MODEL,
  TOONFLOW_SEEDANCE_2_MODEL_ID,
  TOONFLOW_SEEDANCE_2_WIRE_MODEL,
} from './models'

const TOONFLOW_SUBMIT_TIMEOUT_MS = 5 * 60_000
const TOONFLOW_STATUS_TIMEOUT_MS = 60_000
const TOONFLOW_RIGHTS_RESTRICTION_REASON =
  'The request failed because the output video may be related to copyright restrictions.'
const TOONFLOW_DIAGNOSTIC_MAX_LENGTH = 512
const TOONFLOW_INSUFFICIENT_BALANCE_PATTERN = /^余额不足(?:[，,。：:].*)?$/u

const toonflowLogger = createScopedLogger({
  module: 'ai-provider.toonflow',
  provider: 'toonflow',
})

type ToonflowReference =
  | {
    type: 'image_url'
    image_url: { url: string }
    role: 'first_frame' | 'last_frame' | 'reference_image'
  }
  | {
    type: 'audio_url'
    audio_url: { url: string }
    role: 'reference_audio'
  }
  | {
    type: 'video_url'
    video_url: { url: string }
    role: 'reference_video'
  }

type ToonflowGeneratePayload = {
  model: string
  prompt: string
  resolution: string
  duration: number
  metadata: {
    ratio: string
    generate_audio: boolean
    references: ToonflowReference[]
    watermark: false
    seed: -1
  }
}

type ToonflowVideoPollResult =
  | { status: 'pending' }
  | { status: 'completed'; videoUrl: string }
  | {
    status: 'failed'
    failure: ReturnType<typeof createProviderAsyncTaskFailure>
  }

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readDiagnosticMessage(envelope: Record<string, unknown> | null): string {
  const raw = readString(envelope?.message) || readString(envelope?.msg)
  return raw.slice(0, TOONFLOW_DIAGNOSTIC_MAX_LENGTH)
}

function readNumericCode(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10)
  }
  return null
}

function classifyToonflowTerminalFailure(reason: string): UnifiedErrorCode {
  if (reason === TOONFLOW_RIGHTS_RESTRICTION_REASON) {
    return 'CONTENT_RIGHTS_RESTRICTION'
  }
  return 'GENERATION_FAILED'
}

function buildToonflowUrl(baseUrl: string | undefined, path: string): string {
  const normalized = baseUrl?.trim().replace(/\/+$/u, '') ?? ''
  if (!normalized) throw new Error('PROVIDER_BASE_URL_MISSING: toonflow (video)')
  return `${normalized}${path}`
}

function classifyToonflowError(input: {
  code: number | null
  status?: number
  phase: 'submit' | 'poll'
  diagnosticMessage?: string
  cause?: unknown
}): Error {
  const code = input.code ?? input.status ?? null
  const diagnosticMessage = input.diagnosticMessage?.trim().slice(
    0,
    TOONFLOW_DIAGNOSTIC_MAX_LENGTH,
  ) || undefined
  const details = {
    providerCode: input.code,
    httpStatus: input.status ?? null,
  }
  const context = {
    system: 'provider' as const,
    provider: 'toonflow',
    phase: input.phase,
  }
  const createProviderError = (errorCode: UnifiedErrorCode): AppError => {
    if (
      input.phase === 'submit'
      && input.code !== null
      && errorCode !== 'EXTERNAL_ERROR'
    ) {
      return new ProviderSubmissionError(errorCode, diagnosticMessage || getErrorSpec(errorCode).defaultMessage, {
        disposition: 'rejected',
        provider: 'toonflow',
        details,
        context,
        cause: input.cause,
      })
    }
    return new AppError(errorCode, diagnosticMessage, {
      details,
      context,
      cause: input.cause,
    })
  }
  if (
    input.phase === 'submit'
    && input.code === 400
    && diagnosticMessage
    && TOONFLOW_INSUFFICIENT_BALANCE_PATTERN.test(diagnosticMessage)
  ) {
    return createProviderError('PROVIDER_BILLING_REQUIRED')
  }
  if (code === 401 || code === 403) {
    return createProviderError('PROVIDER_AUTH_INVALID')
  }
  if (code === 402) {
    return createProviderError('PROVIDER_BILLING_REQUIRED')
  }
  if (code === 429) {
    return createProviderError('QUOTA_EXCEEDED')
  }
  if (code !== null && code >= 400 && code < 500) {
    return createProviderError('PROVIDER_SUBMISSION_REJECTED')
  }
  return createProviderError('EXTERNAL_ERROR')
}

function throwToonflowFetchError(error: unknown, phase: 'submit' | 'poll'): never {
  if (error instanceof FetchStatusError) {
    let payload: unknown = null
    try {
      payload = JSON.parse(error.responseText) as unknown
    } catch {}
    const envelope = asRecord(payload)
    throw classifyToonflowError({
      code: readNumericCode(envelope?.code),
      status: error.status,
      phase,
      diagnosticMessage: readDiagnosticMessage(envelope),
      cause: error,
    })
  }
  throw error
}

async function postToonflowJson(input: {
  path: string
  baseUrl: string | undefined
  apiKey: string
  payload: Record<string, unknown>
  phase: 'submit' | 'poll'
}): Promise<unknown> {
  let response: Response
  try {
    const url = buildToonflowUrl(input.baseUrl, input.path)
    const request: RequestInit = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input.payload),
      cache: 'no-store',
    }
    if (input.phase === 'submit') {
      response = await fetchWithRetry(url, {
        ...request,
        timeoutMs: TOONFLOW_SUBMIT_TIMEOUT_MS,
        operation: EXTERNAL_OPERATION.PROVIDER_SUBMIT,
        scope: 'toonflow:video:submit',
        fetchFn: fetchWithProviderProxy,
      })
    } else {
      response = await fetchWithProviderProxy(url, {
        ...request,
        signal: AbortSignal.timeout(TOONFLOW_STATUS_TIMEOUT_MS),
      })
      if (!response.ok) {
        throw new FetchStatusError(response.status, await response.text())
      }
    }
  } catch (error) {
    throwToonflowFetchError(error, input.phase)
  }
  return await response.json() as unknown
}

function requireCanonicalTaskCode(value: unknown): string {
  const taskCode = readString(value)
  if (!taskCode || !/^[A-Za-z0-9_-]+$/u.test(taskCode)) {
    throw new Error('TOONFLOW_VIDEO_SUBMIT_RESPONSE_MISSING_TASK_CODE')
  }
  return taskCode
}

function requireCanonicalVideoUrl(value: unknown): string {
  const rawUrl = readString(value)
  if (!rawUrl) throw new Error('TOONFLOW_VIDEO_RESULT_URL_MISSING')
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('TOONFLOW_VIDEO_RESULT_URL_INVALID')
  }
  return url.toString()
}

function uniqueUrls(values: readonly string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)))
}

function requireStringOption(value: unknown, field: string): string {
  const normalized = readString(value)
  if (!normalized) {
    throw new AppError('INVALID_PARAMS', `Toonflow video option is required: ${field}`, {
      provider: 'toonflow',
    })
  }
  return normalized
}

function buildReferences(input: {
  imageUrl: string
  lastFrameImageUrl?: string
  referenceImages?: readonly string[]
  referenceAudios?: readonly string[]
  referenceVideos?: readonly string[]
}): ToonflowReference[] {
  const firstFrame = input.imageUrl.trim()
  const lastFrame = input.lastFrameImageUrl?.trim() ?? ''
  const extraImages = uniqueUrls(input.referenceImages).filter((url) => url !== firstFrame)
  const audios = uniqueUrls(input.referenceAudios)
  const videos = uniqueUrls(input.referenceVideos)

  if (extraImages.length > 9 || audios.length > 3 || videos.length > 3) {
    throw new AppError('INVALID_PARAMS', 'Toonflow reference channel limit exceeded', {
      provider: 'toonflow',
    })
  }
  if (extraImages.length + audios.length + videos.length > 12) {
    throw new AppError('INVALID_PARAMS', 'Toonflow total reference limit exceeded', {
      provider: 'toonflow',
    })
  }
  if (audios.length > 0 && extraImages.length === 0 && videos.length === 0) {
    throw new AppError('INVALID_PARAMS', 'Toonflow reference audio requires an image or video', {
      provider: 'toonflow',
    })
  }

  if (lastFrame) {
    if (!firstFrame) {
      throw new AppError('INVALID_PARAMS', 'Toonflow last frame requires a first frame', {
        provider: 'toonflow',
      })
    }
    if (extraImages.length > 0 || audios.length > 0 || videos.length > 0) {
      throw new AppError('INVALID_PARAMS', 'Toonflow frame mode cannot be combined with references', {
        provider: 'toonflow',
      })
    }
    return [
      { type: 'image_url', image_url: { url: firstFrame }, role: 'first_frame' },
      { type: 'image_url', image_url: { url: lastFrame }, role: 'last_frame' },
    ]
  }

  if (firstFrame && (extraImages.length > 0 || audios.length > 0 || videos.length > 0)) {
    throw new AppError('INVALID_PARAMS', 'Toonflow frame mode cannot be combined with references', {
      provider: 'toonflow',
    })
  }

  return [
    ...(firstFrame
      ? [{ type: 'image_url' as const, image_url: { url: firstFrame }, role: 'first_frame' as const }]
      : []),
    ...extraImages.map((url) => ({
      type: 'image_url' as const,
      image_url: { url },
      role: 'reference_image' as const,
    })),
    ...audios.map((url) => ({
      type: 'audio_url' as const,
      audio_url: { url },
      role: 'reference_audio' as const,
    })),
    ...videos.map((url) => ({
      type: 'video_url' as const,
      video_url: { url },
      role: 'reference_video' as const,
    })),
  ]
}

function buildGeneratePayload(
  input: AiProviderVideoExecutionContext,
): ToonflowGeneratePayload {
  const options = input.options ?? {}
  const duration = options.duration
  const generateAudio = options.generateAudio
  if (typeof duration !== 'number' || !Number.isInteger(duration)) {
    throw new AppError('INVALID_PARAMS', 'Toonflow video duration is required', {
      provider: 'toonflow',
    })
  }
  if (typeof generateAudio !== 'boolean') {
    throw new AppError('INVALID_PARAMS', 'Toonflow generateAudio must be explicit', {
      provider: 'toonflow',
    })
  }
  const modelId = requireSelectedModelId(input.selection, 'toonflow:video')
  const wireModel = modelId === TOONFLOW_SEEDANCE_2_MODEL_ID
    ? TOONFLOW_SEEDANCE_2_WIRE_MODEL
    : modelId === TOONFLOW_SEEDANCE_2_FAST_MODEL_ID
      ? TOONFLOW_SEEDANCE_2_FAST_WIRE_MODEL
      : null
  if (!wireModel) {
    throw new AppError('INVALID_PARAMS', `Toonflow video model is unsupported: ${modelId}`, {
      provider: 'toonflow',
    })
  }
  return {
    model: wireModel,
    prompt: requireStringOption(options.prompt, 'prompt'),
    resolution: requireStringOption(options.resolution, 'resolution'),
    duration,
    metadata: {
      ratio: requireStringOption(options.aspectRatio, 'aspectRatio'),
      generate_audio: generateAudio,
      references: buildReferences({
        imageUrl: input.imageUrl,
        lastFrameImageUrl: options.lastFrameImageUrl,
        referenceImages: options.referenceImages,
        referenceAudios: options.referenceAudios,
        referenceVideos: options.referenceVideos,
      }),
      watermark: false,
      seed: -1,
    },
  }
}

export async function submitToonflowVideoTask(input: {
  baseUrl: string | undefined
  apiKey: string
  payload: ToonflowGeneratePayload
}): Promise<string> {
  const raw = await postToonflowJson({
    path: '/video/generateVideo',
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    payload: input.payload as unknown as Record<string, unknown>,
    phase: 'submit',
  })
  const envelope = asRecord(raw)
  const code = readNumericCode(envelope?.code)
  if (code !== 200) {
    throw classifyToonflowError({
      code,
      phase: 'submit',
      diagnosticMessage: readDiagnosticMessage(envelope),
    })
  }
  return requireCanonicalTaskCode(envelope?.data)
}

export async function queryToonflowVideoStatus(input: {
  baseUrl: string | undefined
  apiKey: string
  taskCode: string
}): Promise<ToonflowVideoPollResult> {
  const raw = await postToonflowJson({
    path: '/video/getVideoStatus',
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    payload: { taskICode: input.taskCode },
    phase: 'poll',
  })
  const envelope = asRecord(raw)
  const code = readNumericCode(envelope?.code)
  if (code !== 200) {
    throw classifyToonflowError({
      code,
      phase: 'poll',
      diagnosticMessage: readDiagnosticMessage(envelope),
    })
  }
  const data = asRecord(envelope?.data)
  const returnedTaskCode = readString(data?.id)
  if (returnedTaskCode !== input.taskCode) {
    throw new Error('TOONFLOW_VIDEO_STATUS_TASK_CODE_MISMATCH')
  }
  const status = readString(data?.status)
  if (status === 'running') return { status: 'pending' }
  if (status === 'success') {
    return {
      status: 'completed',
      videoUrl: requireCanonicalVideoUrl(data?.data),
    }
  }
  if (status === 'failed') {
    const providerFailReason = readString(data?.failReason)
    const errorCode = classifyToonflowTerminalFailure(providerFailReason)
    toonflowLogger.error({
      action: 'toonflow.video.generation_failed',
      message: 'Toonflow accepted video generation ended in failed state',
      errorCode,
      retryable: false,
      details: {
        taskCode: input.taskCode,
        providerFailReason: providerFailReason.slice(0, 512) || null,
        providerFailReasonTruncated: providerFailReason.length > 512,
      },
    })
    return {
      status: 'failed',
      failure: createProviderAsyncTaskFailure({
        provider: 'toonflow',
        code: errorCode,
        message: providerFailReason || errorCode,
        cause: envelope,
      }),
    }
  }
  throw new Error(`TOONFLOW_VIDEO_STATUS_UNKNOWN:${status || '<missing>'}`)
}

export async function executeToonflowVideoGeneration(
  input: AiProviderVideoExecutionContext,
): Promise<GenerateResult> {
  const modelId = requireSelectedModelId(input.selection, 'toonflow:video')
  if (
    modelId !== TOONFLOW_SEEDANCE_2_MODEL_ID
    && modelId !== TOONFLOW_SEEDANCE_2_FAST_MODEL_ID
  ) {
    throw new AppError('INVALID_PARAMS', `Toonflow video model is unsupported: ${modelId}`, {
      provider: 'toonflow',
    })
  }
  const { apiKey, baseUrl } = await getProviderConfig(input.userId, input.selection.provider)
  if (!apiKey.trim()) {
    throw new AppError('PROVIDER_AUTH_INVALID', undefined, { provider: 'toonflow' })
  }
  const taskCode = await submitToonflowVideoTask({
    baseUrl,
    apiKey,
    payload: buildGeneratePayload(input),
  })
  return {
    success: true,
    async: true,
    requestId: taskCode,
    endpoint: 'video',
    externalId: `TOONFLOW:VIDEO:${taskCode}`,
  }
}
