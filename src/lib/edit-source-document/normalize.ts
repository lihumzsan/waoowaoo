import { EDIT_SOURCE_DOCUMENT_MAX_NORMALIZED_CHARS } from './constraints'
import { EditSourceDocumentValidationError } from './errors'

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function normalizeInvisibleControls(text: string): string {
  return text
    .replace(/\u0000/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
}

export function normalizeEditSourceDocumentText(rawText: string): string {
  const normalized = normalizeInvisibleControls(normalizeLineEndings(rawText.normalize('NFC'))).trim()
  if (!normalized) {
    throw new EditSourceDocumentValidationError('EDIT_SOURCE_DOCUMENT_EMPTY')
  }
  if (normalized.length > EDIT_SOURCE_DOCUMENT_MAX_NORMALIZED_CHARS) {
    throw new EditSourceDocumentValidationError(
      'EDIT_SOURCE_DOCUMENT_CHAR_LIMIT_EXCEEDED',
      `EDIT_SOURCE_DOCUMENT_CHAR_LIMIT_EXCEEDED:length=${String(normalized.length)}:max=${String(EDIT_SOURCE_DOCUMENT_MAX_NORMALIZED_CHARS)}`,
    )
  }
  return normalized
}
