export const PROJECT_ASSISTANT_TEXT_ATTACHMENT_METADATA_KEY = 'projectAssistantTextAttachments' as const

export const PROJECT_ASSISTANT_TEXT_ATTACHMENT_ACCEPT = [
  '.txt',
  '.md',
  '.markdown',
  '.docx',
  'text/plain',
  'text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
].join(',')

export const PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_FILES = 4
export const PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_SIZE_BYTES = 8 * 1024 * 1024
export const PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_CHARS = 120_000

export type ProjectAssistantTextAttachmentKind = 'txt' | 'markdown' | 'docx'

export interface ProjectAssistantTextAttachment {
  readonly id: string
  readonly kind: ProjectAssistantTextAttachmentKind
  readonly fileName: string
  readonly mimeType: string
  readonly sizeBytes: number
  readonly checksum: string
  readonly charCount: number
  readonly normalizedText: string
}

export interface ProjectAssistantTextAttachmentUploadResponse {
  readonly attachment: ProjectAssistantTextAttachment
}

export interface ProjectAssistantTextAttachmentApiError {
  readonly code: string
  readonly message: string
}
