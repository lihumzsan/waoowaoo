import { AppError } from '@/lib/errors/app-error'
import { EXTERNAL_OPERATION } from '@/lib/external-operation/registry'
import { ProviderSubmissionError } from '@/lib/ai-exec/submission-error'
import { getProviderConfig } from '@/lib/user-api/runtime-config'
import type { AiProviderMusicExecutionContext, GenerateResult } from '@/lib/ai-providers/runtime-types'
import { requireSelectedModelId } from '@/lib/ai-providers/shared/model-selection'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import {
  fetchProviderWithRetry,
  ProviderHttpError,
  readProviderJsonResponse,
} from '@/lib/ai-providers/failure'
import { buildMurekaUrl } from './base-url'
import { MUREKA_9_MODEL_ID, MUREKA_MUSIC_PROMPT_MAX_CHARS } from './models'

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readEntityId(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readMurekaHttpErrorMessage(value: unknown): string | null {
  const record = asRecord(value)
  const error = asRecord(record?.error)
  const message = readTrimmedString(error?.message)
    || readTrimmedString(record?.message)
  return message || null
}

function readMurekaErrorCode(value: unknown): string | null {
  const record = asRecord(value)
  const error = asRecord(record?.error)
  return readEntityId(error?.code)
    || readEntityId(record?.code)
    || null
}

type MurekaSubmissionFailure = {
  readonly code:
    | 'PROVIDER_AUTH_INVALID'
    | 'PROVIDER_BILLING_REQUIRED'
    | 'RATE_LIMIT'
    | 'SENSITIVE_CONTENT'
    | 'PROVIDER_SUBMISSION_REJECTED'
  readonly disposition: 'rejected'
}

function classifyMurekaMachineCode(code: string | null): MurekaSubmissionFailure | null {
  const normalizedCode = code?.trim().toLowerCase().replace(/[\s-]+/gu, '_') ?? ''
  switch (normalizedCode) {
    case 'authentication_error':
    case 'authorization_error':
    case 'invalid_api_key':
    case 'unauthorized':
    case 'forbidden':
      return { code: 'PROVIDER_AUTH_INVALID', disposition: 'rejected' }
    case 'insufficient_balance':
    case 'insufficient_credit':
    case 'payment_required':
      return { code: 'PROVIDER_BILLING_REQUIRED', disposition: 'rejected' }
    case 'rate_limit':
    case 'rate_limit_exceeded':
      return { code: 'RATE_LIMIT', disposition: 'rejected' }
    case 'sensitive_content':
    case 'content_policy_violation':
    case 'moderation_blocked':
      return { code: 'SENSITIVE_CONTENT', disposition: 'rejected' }
    case 'bad_request':
    case 'invalid_argument':
    case 'invalid_request':
    case 'invalid_request_error':
    case 'validation_error':
      return { code: 'PROVIDER_SUBMISSION_REJECTED', disposition: 'rejected' }
    default:
      return null
  }
}

function throwMurekaSubmissionFailure(input: {
  readonly payload: unknown
  readonly status?: number
  readonly cause: unknown
}): void {
  const machineCode = readMurekaErrorCode(input.payload)
  const failure = classifyMurekaMachineCode(machineCode)
  if (!failure || !machineCode) return
  throw new ProviderSubmissionError(
    failure.code,
    (readMurekaHttpErrorMessage(input.payload) ?? machineCode).slice(0, 512),
    {
      disposition: failure.disposition,
      provider: 'mureka',
      details: {
        providerCode: machineCode,
        httpStatus: input.status ?? null,
      },
      cause: input.cause,
    },
  )
}

function throwMurekaFetchError(error: unknown): never {
  if (error instanceof ProviderHttpError) {
    throwMurekaSubmissionFailure({
      payload: error.errorEnvelope,
      status: error.statusCode,
      cause: error,
    })
  }
  throw error
}

function requireMurekaPrompt(prompt: string): string {
  // The shared media preflight performs this check before the durable fence.
  // Keep the adapter assertion for direct callers; it is not evidence that a
  // claimed provider invocation was unaccepted.
  if (!prompt.trim()) {
    throw new AppError('INVALID_PARAMS', 'Music prompt is required', { provider: 'mureka' })
  }
  if (prompt.length > MUREKA_MUSIC_PROMPT_MAX_CHARS) {
    throw new AppError(
      'MUSIC_PROMPT_TOO_LONG',
      `Music prompt is ${String(prompt.length)} characters; the model accepts at most ${String(MUREKA_MUSIC_PROMPT_MAX_CHARS)}`,
      {
        provider: 'mureka',
        details: { requested: prompt.length, allowed: MUREKA_MUSIC_PROMPT_MAX_CHARS },
      },
    )
  }
  return prompt
}

async function postMurekaJson(input: {
  readonly path: string
  readonly apiKey: string
  readonly baseUrl?: string
  readonly payload: Record<string, unknown>
  readonly scope: string
}): Promise<unknown> {
  let response: Response
  try {
    response = await fetchProviderWithRetry({
      url: buildMurekaUrl(input.path, input.baseUrl),
      provider: 'mureka',
      phase: 'submit',
      options: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${input.apiKey}`,
        },
        body: JSON.stringify(input.payload),
        operation: EXTERNAL_OPERATION.PROVIDER_SUBMIT,
        cache: 'no-store',
        scope: input.scope,
        fetchFn: fetchWithProviderProxy,
      },
    })
  } catch (error) {
    throwMurekaFetchError(error)
  }
  const payload = await readProviderJsonResponse({
    response,
    provider: 'mureka',
    phase: 'submit',
  })
  throwMurekaSubmissionFailure({
    payload,
    status: response.status,
    cause: {
      name: 'MurekaHttpResponse',
      message: readMurekaHttpErrorMessage(payload) ?? 'Mureka submission response',
      code: readMurekaErrorCode(payload),
      statusCode: response.status,
      errorEnvelope: payload,
    },
  })
  return payload
}

async function uploadMurekaSoundtrackVideo(input: {
  readonly apiKey: string
  readonly baseUrl?: string
  readonly videoUrl: string
}): Promise<string> {
  const form = new FormData()
  form.set('purpose', 'soundtrack')
  form.set('url', input.videoUrl)
  let response: Response
  try {
    response = await fetchProviderWithRetry({
      url: buildMurekaUrl('/v1/files/upload', input.baseUrl),
      provider: 'mureka',
      phase: 'submit',
      options: {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
        },
        body: form,
        operation: EXTERNAL_OPERATION.PROVIDER_SUBMIT,
        cache: 'no-store',
        scope: 'mureka:music:upload',
        fetchFn: fetchWithProviderProxy,
      },
    })
  } catch (error) {
    throwMurekaFetchError(error)
  }
  const data = await readProviderJsonResponse<{ id?: unknown }>({
    response,
    provider: 'mureka',
    phase: 'submit',
  })
  throwMurekaSubmissionFailure({
    payload: data,
    status: response.status,
    cause: {
      name: 'MurekaHttpResponse',
      message: readMurekaHttpErrorMessage(data) ?? 'Mureka upload response',
      code: readMurekaErrorCode(data),
      statusCode: response.status,
      errorEnvelope: data,
    },
  })
  const fileId = readEntityId(data.id)
  if (!fileId) {
    throw new Error('MUREKA_UPLOAD_RESPONSE_FILE_ID_MISSING')
  }
  return fileId
}

export async function executeMurekaMusicGeneration(input: AiProviderMusicExecutionContext): Promise<GenerateResult> {
  const options = input.options ?? {}
  const { apiKey, baseUrl } = await getProviderConfig(input.userId, input.selection.provider)
  if (!apiKey) throw new AppError('PROVIDER_AUTH_INVALID', undefined, { provider: 'mureka' })
  const modelId = requireSelectedModelId(input.selection, 'mureka:music')
  if (modelId !== MUREKA_9_MODEL_ID) {
    throw new AppError('INVALID_PARAMS', `Mureka music model is unsupported: ${modelId}`, { provider: 'mureka' })
  }

  const prompt = requireMurekaPrompt(input.prompt)
  const referenceVideoUrl = readTrimmedString(options.referenceVideoUrl)

  if (referenceVideoUrl) {
    const durationMs = typeof options.referenceVideoDurationMs === 'number' && Number.isInteger(options.referenceVideoDurationMs)
      ? options.referenceVideoDurationMs
      : typeof options.durationSeconds === 'number'
        ? Math.round(options.durationSeconds * 1000)
        : null
    if (!durationMs || durationMs <= 0) {
      throw new AppError('INVALID_PARAMS', 'Soundtrack generation requires the reference video duration', { provider: 'mureka' })
    }
    const windowStartMs = typeof options.scoreWindowStartMs === 'number' ? options.scoreWindowStartMs : 0
    const windowEndMs = typeof options.scoreWindowEndMs === 'number' ? options.scoreWindowEndMs : durationMs
    if (
      !Number.isInteger(windowStartMs) || !Number.isInteger(windowEndMs)
      || windowStartMs < 0 || windowEndMs <= windowStartMs || windowEndMs > durationMs
    ) {
      throw new AppError('INVALID_PARAMS', `Score window is invalid: ${String(windowStartMs)}..${String(windowEndMs)} within ${String(durationMs)}ms`, { provider: 'mureka' })
    }
    const videoId = await uploadMurekaSoundtrackVideo({ apiKey, baseUrl, videoUrl: referenceVideoUrl })
    const task = await postMurekaJson({
      path: '/v1/soundtrack/generate',
      apiKey,
      baseUrl,
      payload: {
        video_id: videoId,
        model: modelId,
        prompt,
        n: 1,
        audio_start: windowStartMs,
        audio_end: windowEndMs,
      },
      scope: 'mureka:music:soundtrack:submit',
    }) as { id?: unknown }
    const taskId = readEntityId(task.id)
    if (!taskId) {
      throw new Error('MUREKA_SOUNDTRACK_RESPONSE_TASK_ID_MISSING')
    }
    return {
      success: true,
      async: true,
      requestId: taskId,
      endpoint: 'song',
      externalId: `MUREKA:MUSIC:song:${taskId}`,
    }
  }

  const task = await postMurekaJson({
    path: '/v1/instrumental/generate',
    apiKey,
    baseUrl,
    payload: {
      model: modelId,
      prompt,
      n: 1,
    },
    scope: 'mureka:music:instrumental:submit',
  }) as { id?: unknown }
  const taskId = readEntityId(task.id)
  if (!taskId) {
    throw new Error('MUREKA_INSTRUMENTAL_RESPONSE_TASK_ID_MISSING')
  }
  return {
    success: true,
    async: true,
    requestId: taskId,
    endpoint: 'instrumental',
    externalId: `MUREKA:MUSIC:instrumental:${taskId}`,
  }
}
