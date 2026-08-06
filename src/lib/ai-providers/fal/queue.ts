import { createScopedLogger } from '@/lib/logging/core'
import { FetchStatusError } from '@/lib/retry'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import { buildFalQueueUrl } from './base-url'
import { AppError } from '@/lib/errors/app-error'
import { getErrorSpec, type UnifiedErrorCode } from '@/lib/errors/codes'
import { submitFalQueueRequest } from './submission'

const falLogger = createScopedLogger({ module: 'ai-provider.fal', provider: 'fal' })

export interface FalQueueStatus {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
  completed: boolean
  failed: boolean
  failureDisposition?: 'retryable' | 'permanent'
  errorCode?: UnifiedErrorCode
  resultUrl?: string
  error?: string
}

interface FalQueueInput {
  [key: string]: unknown
}

export async function submitFalTask(endpoint: string, input: FalQueueInput, apiKey: string): Promise<string> {
  const requestId = await submitFalQueueRequest({
    endpoint,
    apiKey,
    payload: input,
    // Stryker disable next-line StringLiteral: retry scope is observability metadata, not provider behavior.
    scope: `fal:submit:${endpoint}`,
  })

  // Stryker disable next-line StringLiteral,ObjectLiteral: observability text does not change the provider contract.
  falLogger.info({
    action: 'fal.queue.submitted',
    message: 'FAL queue task submitted',
    details: { endpoint, requestId },
  })
  return requestId
}

function readFalBaseEndpoint(endpoint: string): string {
  const [owner, alias] = endpoint.split('/')
  if (!owner || !alias) {
    throw new Error(`FAL_ENDPOINT_INVALID:${endpoint}`)
  }
  return `${owner}/${alias}`
}

function readFalQueueResultUrl(resultData: unknown): string | undefined {
  if (resultData === null) return undefined
  const data = resultData as {
    video?: { url?: unknown }
    audio?: { url?: unknown }
    images?: Array<{ url?: unknown }>
  }
  const candidates: unknown[] = [
    data.video?.url,
    data.audio?.url,
    Array.isArray(data.images) ? data.images[0]?.url : undefined,
  ]
  return candidates.find((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0)
}

function readFalErrorType(errorText: string): string | null {
  let parsed: unknown
  // Stryker disable BlockStatement: malformed JSON is intentionally normalized to the same absent-type result.
  try {
    parsed = JSON.parse(errorText)
  } catch {
    return null
  }
  // Stryker restore BlockStatement
  if (parsed === null) return null
  const detail = (parsed as { detail?: unknown }).detail
  if (!Array.isArray(detail)) return null
  const first = detail[0]
  if (first === null || first === undefined) return null
  const errorType = (first as { type?: unknown }).type
  return typeof errorType === 'string' ? errorType : null
}

function toFalHttpAppError(error: FetchStatusError): AppError | null {
  if (error.status === 401 || error.status === 403) {
    return new AppError('PROVIDER_AUTH_INVALID', undefined, { provider: 'fal', cause: error })
  }
  if (error.status === 402) {
    return new AppError('PROVIDER_BILLING_REQUIRED', undefined, { provider: 'fal', cause: error })
  }
  if (error.status === 429) {
    return new AppError('RATE_LIMIT', undefined, { provider: 'fal', cause: error })
  }
  if (error.status === 422 && readFalErrorType(error.responseText) === 'content_policy_violation') {
    return new AppError('SENSITIVE_CONTENT', undefined, { provider: 'fal', cause: error })
  }
  return null
}

function codeFromFalFailureToken(error: string): UnifiedErrorCode {
  switch (error.trim().toLowerCase()) {
    case 'insufficient balance':
    case 'insufficient credit':
      return 'PROVIDER_BILLING_REQUIRED'
    case 'content moderation failed':
    case 'content policy violation':
    case 'content_policy_violation':
    case 'nsfw content detected':
      return 'SENSITIVE_CONTENT'
    default:
      return 'EXTERNAL_ERROR'
  }
}

function parseFalResultFetchError(status: number, errorText: string): FalQueueStatus | null {
  if (status === 422) {
    const errorType = readFalErrorType(errorText)
    const errorCode = errorType === 'content_policy_violation'
      ? 'SENSITIVE_CONTENT'
      : 'PROVIDER_SUBMISSION_REJECTED'
    const errorMessage = errorType === 'content_policy_violation'
      ? '⚠️ 内容审核未通过：生成结果被拦截'
      : errorType
        ? `FAL 错误: ${errorType}`
        : '无法获取结果'

    // Stryker disable next-line StringLiteral,ObjectLiteral: observability text does not change the terminal result.
    falLogger.error({
      action: 'fal.queue.failed',
      message: 'FAL result fetch returned 422 (permanent)',
      details: { httpStatus: status, errorType, errorMessage, failureDisposition: 'permanent' },
    })
    return {
      status: 'COMPLETED',
      completed: true,
      failed: true,
      failureDisposition: getErrorSpec(errorCode).retryable ? 'retryable' : 'permanent',
      errorCode,
      error: errorMessage,
    }
  }

  if (status === 500) {
    const errorDetail = readFalErrorType(errorText) === 'downstream_service_error'
      ? 'FAL 下游服务错误：上游模型处理失败'
      : '下游服务错误'

    // Stryker disable next-line StringLiteral,ObjectLiteral: observability text does not change retry classification.
    falLogger.error({
      action: 'fal.queue.failed',
      message: 'FAL result fetch returned 500, rethrown as transient for retry',
      details: { httpStatus: status, errorDetail },
    })
    throw new FetchStatusError(status, errorDetail)
  }

  return null
}

export async function queryFalStatus(endpoint: string, requestId: string, apiKey: string): Promise<FalQueueStatus> {
  if (!apiKey) {
    throw new AppError('PROVIDER_AUTH_INVALID', undefined, { provider: 'fal' })
  }

  const baseEndpoint = readFalBaseEndpoint(endpoint)

  const statusUrl = buildFalQueueUrl(`${baseEndpoint}/requests/${requestId}/status?logs=0`)
  const response = await fetchWithProviderProxy(statusUrl, {
    method: 'GET',
    headers: {
      Authorization: `Key ${apiKey}`,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    const statusError = new FetchStatusError(response.status, errorText)
    throw toFalHttpAppError(statusError) ?? statusError
  }

  const data = await response.json() as {
    status?: unknown
    response_url?: unknown
    error?: unknown
  }
  const status = data.status

  if (status !== 'IN_QUEUE' && status !== 'IN_PROGRESS' && status !== 'COMPLETED' && status !== 'FAILED') {
    throw new Error(`FAL_STATUS_UNKNOWN:${String(status)}`)
  }

  // 例行 pending 查询不是提交/计费/终态事实，按 provider-gateway 契约只记 DEBUG；
  // 受理、完成、明确失败与查询异常仍保留 INFO/ERROR 可观测性。
  // Stryker disable next-line StringLiteral,ObjectLiteral: observability text does not change status handling.
  falLogger.debug({
    action: 'fal.queue.status',
    message: 'FAL queue status polled',
    details: { endpoint, requestId, status },
  })

  if (status === 'COMPLETED') {
    const resultUrl = typeof data.response_url === 'string'
      ? data.response_url
      : buildFalQueueUrl(`${endpoint}/requests/${requestId}`)
    // 只记 endpoint/requestId identity，不记结果 URL 原文（LG-03）。
    // Stryker disable next-line StringLiteral,ObjectLiteral: observability text does not change result retrieval.
    falLogger.info({
      action: 'fal.queue.completed',
      message: 'FAL queue task completed, fetching result',
      details: { endpoint, requestId, status },
    })

    const resultResponse = await fetchWithProviderProxy(resultUrl, {
      method: 'GET',
      headers: {
        Authorization: `Key ${apiKey}`,
        Accept: 'application/json',
      },
    })

    if (resultResponse.ok) {
      const resultData = await resultResponse.json()
      const mediaUrl = readFalQueueResultUrl(resultData)

      // Stryker disable next-line StringLiteral,ObjectLiteral,BooleanLiteral: observability text does not change media validation.
      falLogger.info({
        action: 'fal.queue.result',
        message: 'FAL queue result fetched',
        details: { endpoint, requestId, hasMedia: Boolean(mediaUrl) },
      })

      if (!mediaUrl) {
        return {
          status: 'COMPLETED',
          completed: true,
          failed: true,
          failureDisposition: 'retryable',
          errorCode: 'EMPTY_RESPONSE',
          error: 'FAL任务完成但未返回媒体URL',
        }
      }

      return {
        status: 'COMPLETED',
        completed: true,
        failed: false,
        resultUrl: mediaUrl,
      }
    }

    const errorText = await resultResponse.text()
    // Stryker disable next-line StringLiteral,ObjectLiteral,MethodExpression: observability text does not change error classification.
    falLogger.error({
      action: 'fal.queue.failed',
      message: 'FAL result fetch failed',
      details: {
        endpoint,
        requestId,
        httpStatus: resultResponse.status,
        errorSnippet: errorText.slice(0, 300),
      },
    })
    const terminalError = parseFalResultFetchError(resultResponse.status, errorText)
    if (terminalError) {
      return terminalError
    }

    const statusError = new FetchStatusError(resultResponse.status, errorText)
    throw toFalHttpAppError(statusError) ?? statusError
  }

  if (status === 'FAILED') {
    const error = typeof data.error === 'string' && data.error.trim() ? data.error : '任务失败'
    const errorCode = codeFromFalFailureToken(error)
    return {
      status: 'FAILED',
      completed: false,
      failed: true,
      failureDisposition: getErrorSpec(errorCode).retryable ? 'retryable' : 'permanent',
      errorCode,
      error,
    }
  }

  return {
    status,
    completed: false,
    failed: false,
  }
}

/**
 * Best-effort cancellation of an accepted FAL queue request.
 * Cancel URL is the request base URL + `/cancel` (the status URL without `/status`).
 * Idempotent by contract: 2xx means the cancellation was accepted; any 4xx means
 * the request is already terminal, already canceled, or unknown — all tolerated
 * as a no-op because the caller has already durably disowned the external id.
 * Only transport failures / 5xx throw so the caller can log the failed attempt.
 */
export async function cancelFalTask(endpoint: string, requestId: string, apiKey: string): Promise<void> {
  if (!apiKey) {
    throw new AppError('PROVIDER_AUTH_INVALID', undefined, { provider: 'fal' })
  }

  const baseEndpoint = readFalBaseEndpoint(endpoint)
  const cancelUrl = buildFalQueueUrl(`${baseEndpoint}/requests/${requestId}/cancel`)
  const response = await fetchWithProviderProxy(cancelUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Key ${apiKey}`,
    },
  })

  if (response.ok) {
    // Stryker disable next-line StringLiteral,ObjectLiteral: observability text does not change the cancel protocol.
    falLogger.info({
      action: 'fal.queue.cancelled',
      message: 'FAL cancel accepted',
      details: { endpoint, requestId },
    })
    return
  }

  const errorText = await response.text()
  if (response.status >= 400 && response.status < 500) {
    // Stryker disable next-line StringLiteral,ObjectLiteral,MethodExpression: observability text does not change the tolerated outcome.
    falLogger.warn({
      action: 'fal.queue.cancel_rejected',
      message: 'FAL cancel rejected: request already terminal or unknown',
      details: {
        endpoint,
        requestId,
        httpStatus: response.status,
        errorSnippet: errorText.slice(0, 300),
      },
    })
    return
  }
  throw new FetchStatusError(response.status, errorText)
}
