import { ApiError } from '@google/genai'
import { ProviderSubmissionError } from '@/lib/ai-exec/submission-error'
import { ProviderHttpError, readProviderJsonResponse } from '@/lib/ai-providers/failure'
import type { UnifiedErrorCode } from '@/lib/errors/codes'

type UnknownRecord = Record<string, unknown>

const EXPLICIT_GOOGLE_REJECTION_STATUSES = new Set([400, 401, 403, 404])

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null
}

function codeForGoogleStatus(status: number): UnifiedErrorCode {
  if (status === 401 || status === 403) return 'PROVIDER_AUTH_INVALID'
  if (status === 404) return 'MODEL_NOT_OPEN'
  return 'PROVIDER_SUBMISSION_REJECTED'
}

function createGoogleSubmissionError(input: {
  readonly status: number
  readonly message: string
  readonly providerCode?: string | number | null
  readonly cause: unknown
}): ProviderSubmissionError {
  return new ProviderSubmissionError(
    codeForGoogleStatus(input.status),
    input.message.slice(0, 512),
    {
      disposition: 'rejected',
      provider: 'google',
      details: {
        httpStatus: input.status,
        ...(input.providerCode === undefined || input.providerCode === null
          ? {}
          : { providerCode: input.providerCode }),
      },
      cause: input.cause,
    },
  )
}

export async function captureGoogleSdkSubmission<T>(submit: () => Promise<T>): Promise<T> {
  try {
    return await submit()
  } catch (error: unknown) {
    if (error instanceof ProviderSubmissionError) throw error
    if (error instanceof ApiError && EXPLICIT_GOOGLE_REJECTION_STATUSES.has(error.status)) {
      throw createGoogleSubmissionError({
        status: error.status,
        message: error.message || 'Google rejected the request',
        cause: error,
      })
    }
    throw error
  }
}

export async function assertGoogleSubmissionResponse(response: Response): Promise<void> {
  if (!EXPLICIT_GOOGLE_REJECTION_STATUSES.has(response.status)) return

  const payload = await readProviderJsonResponse({
    response,
    provider: 'google',
    phase: 'submit',
  })
  const error = asRecord(asRecord(payload)?.error)
  const providerCode = typeof error?.code === 'number' || typeof error?.code === 'string'
    ? error.code
    : null
  const providerStatus = typeof error?.status === 'string' ? error.status.trim() : ''
  const message = typeof error?.message === 'string' ? error.message.trim() : ''
  if (providerCode === null || !providerStatus || !message) {
    throw new ProviderHttpError({
      provider: 'google',
      phase: 'submit',
      statusCode: response.status,
      requestId: response.headers.get('x-request-id'),
      contentType: response.headers.get('content-type'),
      diagnosticText: message || `Google returned an unrecognized HTTP ${String(response.status)} error response`,
      errorEnvelope: payload,
    })
  }

  throw createGoogleSubmissionError({
    status: response.status,
    message,
    providerCode,
    cause: {
      name: 'GoogleHttpError',
      message,
      code: providerCode,
      statusCode: response.status,
      errorEnvelope: payload,
    },
  })
}

export function googleSafetyTerminalError(
  finishReason: string,
  cause: unknown,
): ProviderSubmissionError {
  return new ProviderSubmissionError(
    'SENSITIVE_CONTENT',
    'Google blocked generation by policy',
    {
      disposition: 'rejected',
      provider: 'google',
      details: { finishReason },
      context: { system: 'provider', provider: 'google', phase: 'result' },
      cause,
    },
  )
}
