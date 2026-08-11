import { createScopedLogger } from '@/lib/logging/core'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import { buildFalQueueUrl } from './base-url'
import { AppError } from '@/lib/errors/app-error'
import type { UnifiedErrorCode } from '@/lib/errors/codes'
import { createProviderAsyncTaskFailure } from '@/lib/ai-providers/shared/async-task-status'
import type { FailureRecord } from '@/lib/errors/failure'
import { submitFalQueueRequest } from './submission'
import {
  captureProviderHttpFailure,
  ProviderHttpError,
  readProviderJsonResponse,
} from '@/lib/ai-providers/failure'

const falLogger = createScopedLogger({ module: 'ai-provider.fal', provider: 'fal' })

export interface FalQueueStatus {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
  completed: boolean
  failed: boolean
  failure?: FailureRecord
  resultUrl?: string
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

function readFalErrorType(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null
  const detail = (payload as { detail?: unknown }).detail
  if (!Array.isArray(detail)) return null
  const first = detail[0]
  if (first === null || first === undefined) return null
  const errorType = (first as { type?: unknown }).type
  return typeof errorType === 'string' ? errorType : null
}

function toFalHttpAppError(error: ProviderHttpError): AppError | null {
  if (error.statusCode === 401 || error.statusCode === 403) {
    return new AppError('PROVIDER_AUTH_INVALID', undefined, { provider: 'fal', cause: error })
  }
  if (error.statusCode === 402) {
    return new AppError('PROVIDER_BILLING_REQUIRED', undefined, { provider: 'fal', cause: error })
  }
  if (error.statusCode === 429) {
    return new AppError('RATE_LIMIT', undefined, { provider: 'fal', cause: error })
  }
  if (error.statusCode === 422 && readFalErrorType(error.errorEnvelope) === 'content_policy_violation') {
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

function parseFalResultFetchError(source: ProviderHttpError): FalQueueStatus | null {
  if (source.statusCode === 422) {
    const errorType = readFalErrorType(source.errorEnvelope)
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
      message: 'FAL result fetch returned a terminal 422 response',
      details: { httpStatus: source.statusCode, errorType, errorMessage },
    })
    return {
      status: 'COMPLETED',
      completed: true,
      failed: true,
      failure: createProviderAsyncTaskFailure({
        provider: 'fal',
        code: errorCode,
        message: errorMessage,
        cause: source,
      }),
    }
  }

  if (source.statusCode === 500) {
    const errorDetail = readFalErrorType(source.errorEnvelope) === 'downstream_service_error'
      ? 'FAL 下游服务错误：上游模型处理失败'
      : '下游服务错误'

    // Stryker disable next-line StringLiteral,ObjectLiteral: observability text does not change execution policy.
    falLogger.error({
      action: 'fal.queue.failed',
      message: 'FAL result fetch returned 500; preserving the transport failure',
      details: { httpStatus: source.statusCode, errorDetail },
    })
    throw source
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
    const source = await captureProviderHttpFailure({
      response,
      provider: 'fal',
      phase: 'poll',
    })
    throw toFalHttpAppError(source) ?? source
  }

  const data = await readProviderJsonResponse<{
    status?: unknown
    response_url?: unknown
    error?: unknown
  }>({ response, provider: 'fal', phase: 'poll' })
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
      const resultData = await readProviderJsonResponse({
        response: resultResponse,
        provider: 'fal',
        phase: 'result',
      })
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
          failure: createProviderAsyncTaskFailure({
            provider: 'fal',
            code: 'EMPTY_RESPONSE',
            message: 'FAL任务完成但未返回媒体URL',
            cause: resultData,
          }),
        }
      }

      return {
        status: 'COMPLETED',
        completed: true,
        failed: false,
        resultUrl: mediaUrl,
      }
    }

    const source = await captureProviderHttpFailure({
      response: resultResponse,
      provider: 'fal',
      phase: 'result',
    })
    // Stryker disable next-line StringLiteral,ObjectLiteral,MethodExpression: observability text does not change error classification.
    falLogger.error({
      action: 'fal.queue.failed',
      message: 'FAL result fetch failed',
      details: {
        endpoint,
        requestId,
        httpStatus: resultResponse.status,
        errorSnippet: source.message.slice(0, 300),
      },
    })
    const terminalError = parseFalResultFetchError(source)
    if (terminalError) {
      return terminalError
    }

    throw toFalHttpAppError(source) ?? source
  }

  if (status === 'FAILED') {
    const error = typeof data.error === 'string' && data.error.trim() ? data.error : '任务失败'
    const errorCode = codeFromFalFailureToken(error)
    return {
      status: 'FAILED',
      completed: false,
      failed: true,
      failure: createProviderAsyncTaskFailure({
        provider: 'fal',
        code: errorCode,
        message: error,
        cause: data,
      }),
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

  const source = await captureProviderHttpFailure({
    response,
    provider: 'fal',
    phase: 'cancel',
  })
  if (response.status >= 400 && response.status < 500) {
    // Stryker disable next-line StringLiteral,ObjectLiteral,MethodExpression: observability text does not change the tolerated outcome.
    falLogger.warn({
      action: 'fal.queue.cancel_rejected',
      message: 'FAL cancel rejected: request already terminal or unknown',
      details: {
        endpoint,
        requestId,
        httpStatus: response.status,
        errorSnippet: source.message.slice(0, 300),
      },
    })
    return
  }
  throw source
}
