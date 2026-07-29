import { logDebug as _ulogDebug, logInfo as _ulogInfo, logWarn as _ulogWarn, logError as _ulogError } from '@/lib/logging/core'
import { FetchStatusError, fetchWithRetry, RETRY_POLICY } from '@/lib/retry'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import { buildFalQueueUrl } from './base-url'

export interface FalQueueStatus {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
  completed: boolean
  failed: boolean
  failureDisposition?: 'retryable' | 'permanent'
  resultUrl?: string
  error?: string
}

interface FalQueueInput {
  [key: string]: unknown
}

export async function submitFalTask(endpoint: string, input: FalQueueInput, apiKey: string): Promise<string> {
  if (!apiKey) {
    throw new Error('请配置 FAL API Key')
  }

  const response = await fetchWithRetry(buildFalQueueUrl(endpoint), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Key ${apiKey}`,
    },
    body: JSON.stringify(input),
    policy: RETRY_POLICY.providerSubmit,
    // Stryker disable next-line StringLiteral: retry scope is observability metadata, not provider behavior.
    scope: `fal:submit:${endpoint}`,
    fetchFn: fetchWithProviderProxy,
  })

  const data = await response.json() as { request_id?: unknown }
  const requestId = typeof data.request_id === 'string' ? data.request_id : ''

  if (!requestId) {
    throw new Error('FAL未返回request_id')
  }

  // Stryker disable next-line StringLiteral: observability text does not change the provider contract.
  _ulogInfo(`[FAL Queue] 任务已提交: ${requestId}`)
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

function parseFalResultFetchError(status: number, errorText: string): FalQueueStatus | null {
  if (status === 422) {
    const errorType = readFalErrorType(errorText)
    const errorMessage = errorType === 'content_policy_violation'
      ? '⚠️ 内容审核未通过：生成结果被拦截'
      : errorType
        ? `FAL 错误: ${errorType}`
        : '无法获取结果'

    // Stryker disable next-line StringLiteral: observability text does not change the terminal result.
    _ulogError(`[FAL Status] 422 错误: ${errorMessage}`)
    return {
      status: 'COMPLETED',
      completed: true,
      failed: true,
      failureDisposition: 'permanent',
      error: errorMessage,
    }
  }

  if (status === 500) {
    const errorDetail = readFalErrorType(errorText) === 'downstream_service_error'
      ? 'FAL 下游服务错误：上游模型处理失败'
      : '下游服务错误'

    // Stryker disable next-line StringLiteral: observability text does not change retry classification.
    _ulogError(`[FAL Status] 500 错误，交由瞬时错误重试: ${errorDetail}`)
    throw new FetchStatusError(status, errorDetail)
  }

  return null
}

export async function queryFalStatus(endpoint: string, requestId: string, apiKey: string): Promise<FalQueueStatus> {
  if (!apiKey) {
    throw new Error('请配置 FAL API Key')
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
    throw new FetchStatusError(response.status, errorText)
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
  // Stryker disable next-line StringLiteral,MethodExpression: observability text does not change status handling.
  _ulogDebug(`[FAL Status] requestId=${requestId.slice(0, 16)}... 状态=${status}`)

  if (status === 'COMPLETED') {
    const resultUrl = typeof data.response_url === 'string'
      ? data.response_url
      : buildFalQueueUrl(`${endpoint}/requests/${requestId}`)
    // Stryker disable next-line StringLiteral: observability text does not change result retrieval.
    _ulogInfo(`[FAL Status] 任务已完成，获取结果: ${resultUrl}`)

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

      // Stryker disable next-line StringLiteral,BooleanLiteral: observability text does not change media validation.
      _ulogInfo(`[FAL Status] 获取结果成功: hasMedia=${!!mediaUrl}`)

      if (!mediaUrl) {
        return {
          status: 'COMPLETED',
          completed: true,
          failed: true,
          failureDisposition: 'retryable',
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
    // Stryker disable next-line StringLiteral,MethodExpression: observability text does not change error classification.
    _ulogError(`[FAL Status] 获取结果失败 (${resultResponse.status}): ${errorText.slice(0, 300)}`)
    const terminalError = parseFalResultFetchError(resultResponse.status, errorText)
    if (terminalError) {
      return terminalError
    }

    throw new FetchStatusError(resultResponse.status, errorText)
  }

  if (status === 'FAILED') {
    return {
      status: 'FAILED',
      completed: false,
      failed: true,
      failureDisposition: 'retryable',
      error: typeof data.error === 'string' && data.error.trim() ? data.error : '任务失败',
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
    throw new Error('请配置 FAL API Key')
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
    // Stryker disable next-line StringLiteral: observability text does not change the cancel protocol.
    _ulogInfo(`[FAL Cancel] 取消已受理: requestId=${requestId.slice(0, 16)}...`)
    return
  }

  const errorText = await response.text()
  if (response.status >= 400 && response.status < 500) {
    // Stryker disable next-line StringLiteral,MethodExpression: observability text does not change the tolerated outcome.
    _ulogWarn(`[FAL Cancel] 请求已终态或无法取消 (${response.status}): ${errorText.slice(0, 300)}`)
    return
  }
  throw new FetchStatusError(response.status, errorText)
}
