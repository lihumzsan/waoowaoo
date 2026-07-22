export const CURRENT_USER_TEXT_MATCH_ERROR_CODES = [
  'CURRENT_USER_TEXT_UNAVAILABLE',
  'CURRENT_USER_TEXT_NOT_EXACT',
] as const

export type CurrentUserTextMatchErrorCode = (typeof CURRENT_USER_TEXT_MATCH_ERROR_CODES)[number]

export type CurrentUserTextMatchResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly code: CurrentUserTextMatchErrorCode }

export function matchCurrentUserText(input: {
  readonly currentUserTurnText?: string | null
  readonly requestedText: string
}): CurrentUserTextMatchResult {
  const requestedText = input.requestedText.trim()
  const currentUserTurnText = input.currentUserTurnText ?? ''
  if (!currentUserTurnText.trim()) {
    return { ok: false, code: 'CURRENT_USER_TEXT_UNAVAILABLE' }
  }
  if (!requestedText || !currentUserTurnText.includes(requestedText)) {
    return { ok: false, code: 'CURRENT_USER_TEXT_NOT_EXACT' }
  }
  return { ok: true, text: requestedText }
}
