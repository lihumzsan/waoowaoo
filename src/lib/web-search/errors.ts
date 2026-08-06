/**
 * The complete failure vocabulary of web search.
 *
 * `UNAVAILABLE` means the capability is not configured or the credential was
 * rejected — retrying changes nothing and the caller should say so plainly.
 * `REQUEST_FAILED` is a transport-level fault. This error vocabulary never
 * grants execution replay; callers preserve it as diagnostic evidence only.
 * `RESPONSE_INVALID` means the provider answered but without usable evidence.
 * `ABORTED` is the user's own cancellation and is never a provider fault.
 */
export const WEB_SEARCH_ERROR_CODES = [
  'WEB_SEARCH_UNAVAILABLE',
  'WEB_SEARCH_REQUEST_FAILED',
  'WEB_SEARCH_RESPONSE_INVALID',
  'WEB_SEARCH_ABORTED',
] as const

export type WebSearchErrorCode = (typeof WEB_SEARCH_ERROR_CODES)[number]

export class WebSearchError extends Error {
  readonly code: WebSearchErrorCode
  readonly details: Readonly<Record<string, string | number | boolean | null>>

  constructor(
    code: WebSearchErrorCode,
    details: Readonly<Record<string, string | number | boolean | null>> = {},
    options?: ErrorOptions,
  ) {
    super(code, options)
    this.name = 'WebSearchError'
    this.code = code
    this.details = details
  }
}

export function isWebSearchError(error: unknown): error is WebSearchError {
  return error instanceof WebSearchError
}
