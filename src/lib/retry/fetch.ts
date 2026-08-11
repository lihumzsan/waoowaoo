import { getInternalBaseUrl } from '@/lib/env'
import type { ExternalOperationId } from '@/lib/external-operation/registry'
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
  override readonly cause?: unknown

  constructor(timeoutMs: number, cause?: unknown) {
    super(`Fetch request timed out after ${timeoutMs}ms`)
    this.name = 'FetchTimeoutError'
    this.cause = cause
  }
}

function resolveFetchUrl(url: string): string {
  if (url.startsWith('/')) {
    return `${getInternalBaseUrl()}${url}`
  }
  return url
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  fetchFn: typeof fetch,
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort(new FetchTimeoutError(timeoutMs))
  }, timeoutMs)

  try {
    return await fetchFn(resolveFetchUrl(url), {
      ...options,
      signal: controller.signal,
    })
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new FetchTimeoutError(timeoutMs, error)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export type FetchWithRetryOptions = RequestInit & {
  readonly operation: ExternalOperationId
  readonly timeoutMs?: number
  readonly scope?: string
  readonly fetchFn?: typeof fetch
  readonly httpErrorFactory?: (response: Response) => Promise<Error>
}

export async function fetchWithRetry(url: string, options: FetchWithRetryOptions): Promise<Response> {
  const {
    timeoutMs = 60_000,
    operation,
    scope = `fetch:${url}`,
    fetchFn = fetch,
    httpErrorFactory,
    ...requestOptions
  } = options

  return await withRetry({
    operation,
    scope,
    run: async () => {
      const response = await fetchWithTimeout(url, requestOptions, timeoutMs, fetchFn)
      if (!response.ok) {
        if (httpErrorFactory) throw await httpErrorFactory(response)
        const responseText = await response.text()
        throw new FetchStatusError(response.status, responseText)
      }
      return response
    },
  })
}
