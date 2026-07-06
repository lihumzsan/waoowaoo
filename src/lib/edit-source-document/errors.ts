export type EditSourceDocumentValidationCode =
  | 'EDIT_SOURCE_DOCUMENT_EMPTY'
  | 'EDIT_SOURCE_DOCUMENT_CHAR_LIMIT_EXCEEDED'
  | 'EDIT_SOURCE_DOCUMENT_TOKEN_LIMIT_EXCEEDED'
  | 'EDIT_SOURCE_DOCUMENT_INVALID'

export class EditSourceDocumentValidationError extends Error {
  readonly code: EditSourceDocumentValidationCode

  constructor(code: EditSourceDocumentValidationCode, message?: string) {
    super(message ?? code)
    this.name = 'EditSourceDocumentValidationError'
    this.code = code
  }
}

export function isEditSourceDocumentValidationError(error: unknown): error is EditSourceDocumentValidationError {
  return error instanceof EditSourceDocumentValidationError
}
