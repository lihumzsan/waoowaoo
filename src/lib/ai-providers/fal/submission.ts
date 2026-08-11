import { ProviderSubmissionError } from '@/lib/ai-exec/submission-error'
import { EXTERNAL_OPERATION } from '@/lib/external-operation/registry'
import { getErrorSpec, type UnifiedErrorCode } from '@/lib/errors/codes'
import { AppError } from '@/lib/errors/app-error'
import {
  fetchProviderWithRetry,
  ProviderHttpError,
  readProviderJsonResponse,
} from '@/lib/ai-providers/failure'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import { buildFalQueueUrl } from './base-url'

const FAL_SUBMIT_DIAGNOSTIC_MAX_LENGTH = 512

type FalSubmissionFailure = {
  readonly code: UnifiedErrorCode
  readonly machineCode: string
  readonly message: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeMachineCode(value: unknown): string {
  return readString(value).toLowerCase().replace(/[\s-]+/gu, '_')
}

function classifyFalMachineCode(machineCode: string): UnifiedErrorCode | null {
  switch (machineCode) {
    case 'authentication_error':
    case 'authorization_error':
    case 'invalid_api_key':
    case 'unauthorized':
    case 'forbidden':
      return 'PROVIDER_AUTH_INVALID'
    case 'insufficient_balance':
    case 'insufficient_credit':
    case 'payment_required':
      return 'PROVIDER_BILLING_REQUIRED'
    case 'content_policy_violation':
    case 'moderation_blocked':
    case 'sensitive_content':
      return 'SENSITIVE_CONTENT'
    case 'invalid_argument':
    case 'invalid_request':
    case 'invalid_request_error':
    case 'input_rejected':
    case 'literal_error':
    case 'missing':
    case 'string_too_long':
    case 'string_too_short':
    case 'string_type':
    case 'type_error':
    case 'url_parsing':
    case 'validation_error':
      return 'PROVIDER_SUBMISSION_REJECTED'
    default:
      if (machineCode.startsWith('type_error.') || machineCode.startsWith('value_error')) {
        return 'PROVIDER_SUBMISSION_REJECTED'
      }
      return null
  }
}

function readFalSubmissionFailure(value: unknown): FalSubmissionFailure | null {
  const envelope = asRecord(value)
  if (!envelope) return null
  const error = asRecord(envelope.error)
  const detail = Array.isArray(envelope.detail) ? envelope.detail : []
  const detailEntry = detail.map(asRecord).find((entry) => entry !== null) ?? null
  const machineCodes = [
    error?.code,
    error?.type,
    envelope.code,
    envelope.type,
    detailEntry?.code,
    detailEntry?.type,
  ].map(normalizeMachineCode).filter(Boolean)

  for (const machineCode of machineCodes) {
    const code = classifyFalMachineCode(machineCode)
    if (!code) continue
    const message = (
      readString(error?.message)
      || readString(envelope.message)
      || readString(detailEntry?.msg)
      || getErrorSpec(code).defaultMessage
    ).slice(0, FAL_SUBMIT_DIAGNOSTIC_MAX_LENGTH)
    return { code, machineCode, message }
  }
  return null
}

function throwFalSubmissionFailure(input: {
  readonly payload: unknown
  readonly httpStatus: number | null
  readonly cause: unknown
}): void {
  const failure = readFalSubmissionFailure(input.payload)
  if (!failure) return
  throw new ProviderSubmissionError(failure.code, failure.message, {
    disposition: 'rejected',
    provider: 'fal',
    details: {
      providerCode: failure.machineCode,
      httpStatus: input.httpStatus,
    },
    cause: input.cause,
  })
}

export async function submitFalQueueRequest(input: {
  readonly endpoint: string
  readonly apiKey: string
  readonly payload: Record<string, unknown>
  readonly scope: string
}): Promise<string> {
  if (!input.apiKey) {
    throw new AppError('PROVIDER_AUTH_INVALID', undefined, { provider: 'fal' })
  }

  let response: Response
  try {
    response = await fetchProviderWithRetry({
      url: buildFalQueueUrl(input.endpoint),
      provider: 'fal',
      phase: 'submit',
      options: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Key ${input.apiKey}`,
        },
        body: JSON.stringify(input.payload),
        operation: EXTERNAL_OPERATION.PROVIDER_SUBMIT,
        cache: 'no-store',
        scope: input.scope,
        fetchFn: fetchWithProviderProxy,
      },
    })
  } catch (error: unknown) {
    if (error instanceof ProviderHttpError) {
      throwFalSubmissionFailure({
        payload: error.errorEnvelope,
        httpStatus: error.statusCode,
        cause: error,
      })
    }
    throw error
  }

  const payload = await readProviderJsonResponse({
    response,
    provider: 'fal',
    phase: 'submit',
  })
  const envelope = asRecord(payload)
  const requestId = readString(envelope?.request_id)
  if (requestId) return requestId

  throwFalSubmissionFailure({
    payload,
    httpStatus: response.status,
    cause: {
      name: 'FalSubmissionResponse',
      message: 'FAL submission response did not contain a request id',
      statusCode: response.status,
      errorEnvelope: payload,
    },
  })
  throw new Error('FAL_SUBMIT_RESPONSE_REQUEST_ID_MISSING')
}
