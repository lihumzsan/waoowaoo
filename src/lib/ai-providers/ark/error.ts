import { ProviderSubmissionError } from '@/lib/ai-exec/submission-error'
import { AppError } from '@/lib/errors/app-error'
import type { UnifiedErrorCode } from '@/lib/errors/codes'
import { FetchStatusError } from '@/lib/retry'

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function codeFromArkErrorToken(value: unknown): UnifiedErrorCode | null {
  if (typeof value !== 'string') return null
  const token = value.trim().split(':', 1)[0]?.trim().toUpperCase()
  if (token === 'ACCOUNTOVERDUEERROR' || token === 'ACCOUNT_OVERDUE_ERROR') {
    return 'PROVIDER_BILLING_REQUIRED'
  }
  if (token === 'MODELNOTOPEN' || token === 'MODEL_NOT_OPEN') return 'MODEL_NOT_OPEN'
  return null
}

export function readArkErrorCode(value: unknown): UnifiedErrorCode | null {
  const record = asRecord(value)
  if (!record) return codeFromArkErrorToken(value)
  const nested = asRecord(record.error)
  return codeFromArkErrorToken(nested?.code)
    ?? codeFromArkErrorToken(nested?.message)
    ?? codeFromArkErrorToken(record.code)
    ?? codeFromArkErrorToken(record.message)
}

function readStructuredArkError(value: unknown): {
  readonly providerCode: string | null
  readonly message: string
} | null {
  const record = asRecord(value)
  const nested = asRecord(record?.error)
  if (!nested) return null
  const providerCode = nonEmptyString(nested.code)
  const message = nonEmptyString(nested.message)
  if (!providerCode && !message) return null
  return {
    providerCode,
    message: (message ?? providerCode ?? 'Ark rejected the request').slice(0, 512),
  }
}

function parsePayload(responseText: string): unknown {
  try {
    return JSON.parse(responseText) as unknown
  } catch {
    return responseText
  }
}

function arkSubmissionRejection(input: {
  readonly status: number
  readonly payload: unknown
  readonly cause?: unknown
}): ProviderSubmissionError | null {
  const mappedCode = readArkErrorCode(input.payload)
  const structured = readStructuredArkError(input.payload)
  const isStructuredClientRejection = input.status >= 400
    && input.status < 500
    && input.status !== 429
    && structured !== null
  if (!mappedCode && !isStructuredClientRejection) return null

  const code = mappedCode
    ?? (input.status === 401 || input.status === 403
      ? 'PROVIDER_AUTH_INVALID'
      : input.status === 402
        ? 'PROVIDER_BILLING_REQUIRED'
        : 'PROVIDER_SUBMISSION_REJECTED')
  return new ProviderSubmissionError(
    code,
    structured?.message ?? 'Ark rejected the request',
    {
      disposition: 'rejected',
      provider: 'ark',
      details: {
        httpStatus: input.status,
        ...(structured?.providerCode ? { providerCode: structured.providerCode } : {}),
      },
      cause: input.cause,
    },
  )
}

export function throwArkSubmissionError(error: unknown): never {
  if (error instanceof ProviderSubmissionError) throw error
  if (error instanceof FetchStatusError) {
    const rejection = arkSubmissionRejection({
      status: error.status,
      payload: parsePayload(error.responseText),
      cause: error,
    })
    if (rejection) throw rejection
  }
  throw error
}

export async function assertArkSubmissionResponse(response: Response): Promise<void> {
  if (response.ok) return
  const responseText = await response.clone().text()
  const rejection = arkSubmissionRejection({
    status: response.status,
    payload: parsePayload(responseText),
    cause: new FetchStatusError(response.status, responseText),
  })
  if (rejection) throw rejection
}

export function toArkPollHttpError(status: number, responseText: string): Error {
  const statusError = new FetchStatusError(status, responseText)
  const providerCode = readArkErrorCode(parsePayload(responseText))
  const code = providerCode
    ?? (status === 401 || status === 403
      ? 'PROVIDER_AUTH_INVALID'
      : status === 402
        ? 'PROVIDER_BILLING_REQUIRED'
        : status === 429
          ? 'RATE_LIMIT'
          : null)
  return code
    ? new AppError(code, undefined, { provider: 'ark', cause: statusError })
    : statusError
}
