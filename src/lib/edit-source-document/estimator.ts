import {
  EDIT_SOURCE_DOCUMENT_MAX_ESTIMATED_INPUT_TOKENS,
  EDIT_SOURCE_DOCUMENT_OUTPUT_TOKEN_RESERVE,
  EDIT_SOURCE_DOCUMENT_TOKEN_ESTIMATE,
} from './constraints'
import { EditSourceDocumentValidationError } from './errors'

const CJK_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]/
const WHITESPACE_PATTERN = /\s/
const LATIN_PATTERN = /[A-Za-z0-9]/

export function estimateEditSourceDocumentInputTokens(text: string): number {
  let estimate = 0
  for (const char of text) {
    if (CJK_PATTERN.test(char)) {
      estimate += EDIT_SOURCE_DOCUMENT_TOKEN_ESTIMATE.cjkCodeUnitRatio
    } else if (WHITESPACE_PATTERN.test(char)) {
      estimate += EDIT_SOURCE_DOCUMENT_TOKEN_ESTIMATE.whitespaceCodeUnitRatio
    } else if (LATIN_PATTERN.test(char)) {
      estimate += EDIT_SOURCE_DOCUMENT_TOKEN_ESTIMATE.latinCodeUnitRatio
    } else {
      estimate += EDIT_SOURCE_DOCUMENT_TOKEN_ESTIMATE.punctuationCodeUnitRatio
    }
  }
  return Math.ceil(estimate)
}

export function assertEditSourceDocumentWithinTokenBudget(text: string): number {
  const estimatedInputTokens = estimateEditSourceDocumentInputTokens(text)
  const estimatedTotalTokens = estimatedInputTokens + EDIT_SOURCE_DOCUMENT_OUTPUT_TOKEN_RESERVE
  if (estimatedTotalTokens > EDIT_SOURCE_DOCUMENT_MAX_ESTIMATED_INPUT_TOKENS) {
    throw new EditSourceDocumentValidationError(
      'EDIT_SOURCE_DOCUMENT_TOKEN_LIMIT_EXCEEDED',
      `EDIT_SOURCE_DOCUMENT_TOKEN_LIMIT_EXCEEDED:input=${String(estimatedInputTokens)}:reserve=${String(EDIT_SOURCE_DOCUMENT_OUTPUT_TOKEN_RESERVE)}:max=${String(EDIT_SOURCE_DOCUMENT_MAX_ESTIMATED_INPUT_TOKENS)}`,
    )
  }
  return estimatedInputTokens
}
