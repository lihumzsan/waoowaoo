import type {
  AsyncTaskProviderRegistration,
  FormatAsyncExternalIdInput,
  ParsedAsyncExternalId,
} from '@/lib/ai-providers/async-task-types'
import { normalizeAsyncPollResult } from '@/lib/ai-providers/async-task-types'
import { FetchStatusError } from '@/lib/retry'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import { buildMurekaUrl } from './base-url'

const MUREKA_QUERY_ENDPOINTS = ['song', 'instrumental'] as const

type MurekaQueryEndpoint = typeof MUREKA_QUERY_ENDPOINTS[number]

const MUREKA_TASK_STATUSES = [
  'preparing',
  'queued',
  'running',
  'streaming',
  'succeeded',
  'failed',
  'timeouted',
  'cancelled',
] as const

type MurekaTaskStatus = typeof MUREKA_TASK_STATUSES[number]

interface MurekaTaskResponse {
  status?: unknown
  failed_reason?: unknown
  choices?: unknown
}

function isMurekaQueryEndpoint(value: string | undefined): value is MurekaQueryEndpoint {
  return MUREKA_QUERY_ENDPOINTS.includes(value as MurekaQueryEndpoint)
}

function parseMurekaExternalId(externalId: string): ParsedAsyncExternalId {
  const parts = externalId.split(':')
  const [prefix, type, endpoint, requestId] = parts
  if (prefix !== 'MUREKA' || type !== 'MUSIC' || parts.length !== 4 || !isMurekaQueryEndpoint(endpoint) || !requestId) {
    throw new Error(`无效 MUREKA externalId: "${externalId}"，应为 MUREKA:MUSIC:{song|instrumental}:taskId`)
  }
  return {
    provider: 'MUREKA',
    type: 'MUSIC',
    endpoint,
    requestId,
  }
}

function formatMurekaExternalId(input: FormatAsyncExternalIdInput): string {
  if (!isMurekaQueryEndpoint(input.endpoint)) {
    throw new Error(`MUREKA_EXTERNAL_ID_ENDPOINT_INVALID:${String(input.endpoint)}`)
  }
  return `MUREKA:${input.type}:${input.endpoint}:${input.requestId}`
}

function readMurekaStatus(value: unknown): MurekaTaskStatus {
  if (typeof value === 'string' && MUREKA_TASK_STATUSES.includes(value as MurekaTaskStatus)) {
    return value as MurekaTaskStatus
  }
  throw new Error(`MUREKA_STATUS_UNKNOWN:${String(value)}`)
}

function readMurekaResultUrl(choices: unknown): string {
  if (!Array.isArray(choices)) return ''
  const first = choices[0] as { url?: unknown } | undefined
  return typeof first?.url === 'string' ? first.url.trim() : ''
}

export const murekaAsyncTaskProvider: AsyncTaskProviderRegistration = {
  providerCode: 'MUREKA',
  canParseExternalId: (externalId) => externalId.startsWith('MUREKA:'),
  parseExternalId: parseMurekaExternalId,
  formatExternalId: formatMurekaExternalId,
  poll: async ({ parsed, context }) => {
    if (!isMurekaQueryEndpoint(parsed.endpoint)) {
      throw new Error(`MUREKA_EXTERNAL_ID_ENDPOINT_INVALID:${String(parsed.endpoint)}`)
    }
    const { apiKey, baseUrl } = await context.getProviderConfig(context.userId, 'mureka')
    const response = await fetchWithProviderProxy(
      buildMurekaUrl(`/v1/${parsed.endpoint}/query/${parsed.requestId}`, baseUrl),
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      },
    )
    if (!response.ok) {
      throw new FetchStatusError(response.status, await response.text())
    }
    const data = await response.json() as MurekaTaskResponse
    const status = readMurekaStatus(data.status)

    if (status === 'succeeded') {
      const resultUrl = readMurekaResultUrl(data.choices)
      if (!resultUrl) {
        return normalizeAsyncPollResult({
          status: 'failed',
          failureDisposition: 'retryable',
          error: `MUREKA_RESULT_URL_MISSING:${parsed.requestId}`,
        })
      }
      return normalizeAsyncPollResult({ status: 'completed', resultUrl })
    }
    if (status === 'failed' || status === 'cancelled') {
      const reason = typeof data.failed_reason === 'string' && data.failed_reason.trim()
        ? data.failed_reason.trim()
        : `MUREKA_TASK_${status.toUpperCase()}`
      return normalizeAsyncPollResult({
        status: 'failed',
        failureDisposition: 'permanent',
        error: reason,
      })
    }
    if (status === 'timeouted') {
      return normalizeAsyncPollResult({
        status: 'failed',
        failureDisposition: 'retryable',
        error: `MUREKA_TASK_TIMEOUTED:${parsed.requestId}`,
      })
    }
    return normalizeAsyncPollResult({ status: 'pending' })
  },
}
