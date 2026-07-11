import type { UnifiedErrorCode } from './codes'

export type UserErrorTranslator = (code: UnifiedErrorCode) => string

/**
 * Error codes are the locale-independent authority. User-facing text must be
 * resolved by the active i18n boundary; this module deliberately owns no
 * default language and cannot silently fall back to one.
 */
export function getUserMessageByCode(
  code: UnifiedErrorCode,
  translate: UserErrorTranslator,
): string {
  return translate(code)
}
