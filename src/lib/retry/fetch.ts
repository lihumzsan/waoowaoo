import { getInternalBaseUrl } from '@/lib/env'
import { RETRY_POLICY, type RetryPolicy } from './policy'
import { withRetry } from './with-retry'

export class FetchStatusError extends Error {
  readonly status: number
  readonly responseText: string

  constructor(status: number, responseText: string) {
    super(`Fetch request failed with status ${status}: ${responseText.slice(0, 500)}`)
    this.name = 'FetchStatusError'
    this.status = status
    this.responseText = responseText
  }
}

export class FetchTimeoutError extends Error {
  readonly code = 'NETWORK_ERROR'

  constructor(timeoutMs: number) {
    super(`Fetch request timed out after ${timeoutMs}ms`)
    this.name = 'FetchTimeoutError'
  }
}

function resolveFetchUrl(url: string): string {
  if (url.startsWith('/')) {
    return `${getInternalBaseUrl()}${url}`
  }
  return url
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort(new FetchTimeoutError(timeoutMs))
  }, timeoutMs)

  try {
    return await fetch(resolveFetchUrl(url), {
      ...options,
      signal: controller.signal,
    })
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new FetchTimeoutError(timeoutMs)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export type FetchWithRetryOptions = RequestInit & {
  readonly timeoutMs?: number
  readonly policy?: RetryPolicy
  readonly scope?: string
}

export async function fetchWithRetry(url: string, options: FetchWithRetryOptions = {}): Promise<Response> {
  const {
    timeoutMs = 60_000,
    policy = RETRY_POLICY.mediaFetch,
    scope = `fetch:${url}`,
    ...requestOptions
  } = options

  return await withRetry({
    scope,
    policy,
    run: async () => {
      const response = await fetchWithTimeout(url, requestOptions, timeoutMs)
      if (!response.ok) {
        const responseText = await response.text()
        throw new FetchStatusError(response.status, responseText)
      }
      return response
    },
  })
}
