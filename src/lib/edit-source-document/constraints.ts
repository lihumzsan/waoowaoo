export const EDIT_SOURCE_DOCUMENT_MAX_NORMALIZED_CHARS = 10_000
export const EDIT_SOURCE_DOCUMENT_MAX_ESTIMATED_INPUT_TOKENS = 24_000
export const EDIT_SOURCE_DOCUMENT_OUTPUT_TOKEN_RESERVE = 6_000

export const EDIT_SOURCE_DOCUMENT_TOKEN_ESTIMATE = {
  cjkCodeUnitRatio: 1,
  latinCodeUnitRatio: 0.35,
  whitespaceCodeUnitRatio: 0.05,
  punctuationCodeUnitRatio: 0.4,
} as const
