import { AppError } from '@/lib/errors/app-error'
import { getProviderConfig } from '@/lib/user-api/runtime-config'
import type { AiProviderMusicExecutionContext, GenerateResult } from '@/lib/ai-providers/runtime-types'
import { requireSelectedModelId } from '@/lib/ai-providers/shared/model-selection'
import { FetchStatusError, RETRY_POLICY, fetchWithRetry } from '@/lib/retry'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
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

function classifyMurekaError(code: string | null, status?: number):
  | 'PROVIDER_AUTH_INVALID'
  | 'PROVIDER_BILLING_REQUIRED'
  | 'RATE_LIMIT'
  | 'SENSITIVE_CONTENT'
  | 'PROVIDER_SUBMISSION_REJECTED'
  | 'EXTERNAL_ERROR' {
  const normalizedCode = code?.toLowerCase() ?? ''
  if (
    status === 401 || status === 403
    || normalizedCode === '401' || normalizedCode === '403'
    || normalizedCode === 'unauthorized' || normalizedCode === 'forbidden'
  ) {
    return 'PROVIDER_AUTH_INVALID'
  }
  if (
    status === 402
    || normalizedCode === '402'
    || normalizedCode === 'insufficient_balance'
    || normalizedCode === 'insufficient_credit'
    || normalizedCode === 'payment_required'
  ) {
    return 'PROVIDER_BILLING_REQUIRED'
  }
  if (
    status === 429 || normalizedCode === '429'
    || normalizedCode === 'rate_limit' || normalizedCode === 'rate_limit_exceeded'
  ) return 'RATE_LIMIT'
  if (
    normalizedCode === 'sensitive_content'
    || normalizedCode === 'content_policy_violation'
    || normalizedCode === 'moderation_blocked'
  ) {
    return 'SENSITIVE_CONTENT'
  }
  if (status !== undefined && status >= 500) return 'EXTERNAL_ERROR'
  return 'PROVIDER_SUBMISSION_REJECTED'
}

function murekaAppError(input: {
  readonly message: string
  readonly code?: string | null
  readonly status?: number
  readonly cause?: unknown
}): AppError {
  return new AppError(classifyMurekaError(input.code ?? null, input.status), input.message, {
    provider: 'mureka',
    details: input.status === undefined ? null : { providerStatus: input.status },
    cause: input.cause,
  })
}

function throwMurekaFetchError(error: unknown): never {
  if (error instanceof FetchStatusError) {
    let payload: unknown = error.responseText
    try {
      payload = JSON.parse(error.responseText) as unknown
    } catch {}
    throw murekaAppError({
      message: readMurekaHttpErrorMessage(payload) ?? error.message,
      code: readMurekaErrorCode(payload),
      status: error.status,
      cause: error,
    })
  }
  throw error
}

function requireMurekaPrompt(prompt: string): string {
  // Deterministic pre-submission validation must throw typed AppErrors: the
  // provider fence treats plain Errors from execute() as an ambiguous
  // submission outcome, which both hides the real reason and forbids the
  // immediate corrected retry this input error allows.
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
    response = await fetchWithRetry(buildMurekaUrl(input.path, input.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(input.payload),
      policy: RETRY_POLICY.providerSubmit,
      cache: 'no-store',
      scope: input.scope,
      fetchFn: fetchWithProviderProxy,
    })
  } catch (error) {
    throwMurekaFetchError(error)
  }
  return await response.json() as unknown
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
    response = await fetchWithRetry(buildMurekaUrl('/v1/files/upload', input.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: form,
      policy: RETRY_POLICY.providerSubmit,
      cache: 'no-store',
      scope: 'mureka:music:upload',
      fetchFn: fetchWithProviderProxy,
    })
  } catch (error) {
    throwMurekaFetchError(error)
  }
  const data = await response.json() as { id?: unknown }
  const fileId = readEntityId(data.id)
  if (!fileId) {
    throw new AppError('EXTERNAL_ERROR', 'Mureka upload response did not include a file id', {
      provider: 'mureka',
    })
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
      throw new AppError('EXTERNAL_ERROR', 'Mureka soundtrack response did not include a task id', {
        provider: 'mureka',
      })
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
    throw new AppError('EXTERNAL_ERROR', 'Mureka instrumental response did not include a task id', {
      provider: 'mureka',
    })
  }
  return {
    success: true,
    async: true,
    requestId: taskId,
    endpoint: 'instrumental',
    externalId: `MUREKA:MUSIC:instrumental:${taskId}`,
  }
}
