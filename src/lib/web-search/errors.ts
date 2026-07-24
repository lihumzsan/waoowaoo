export const WEB_SEARCH_ERROR_CODES = [
  'WEB_SEARCH_UNAVAILABLE',
  'WEB_SEARCH_REQUEST_FAILED',
  'WEB_SEARCH_RESPONSE_INVALID',
  'WEB_SEARCH_ABORTED',
] as const

export type WebSearchErrorCode = (typeof WEB_SEARCH_ERROR_CODES)[number]

export class WebSearchError extends Error {
  readonly code: WebSearchErrorCode
  readonly retryable: boolean
  readonly details: Readonly<Record<string, string | number | boolean | null>>

  constructor(
    code: WebSearchErrorCode,
    details: Readonly<Record<string, string | number | boolean | null>> = {},
    options?: ErrorOptions & { retryable?: boolean },
  ) {
    super(code, options)
    this.name = 'WebSearchError'
    this.code = code
    this.retryable = options?.retryable === true
    this.details = details
  }
}

export function isWebSearchError(error: unknown): error is WebSearchError {
  return error instanceof WebSearchError
}
