import { apiFetch } from '@/lib/api-fetch'
import { readClientApiError } from '@/lib/errors/client'
import type {
  ProjectAssistantTextAttachment,
  ProjectAssistantTextAttachmentUploadResponse,
} from './types'
import {
  PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_SIZE_BYTES,
} from './types'

interface UploadProjectAssistantTextAttachmentParams {
  readonly file: File
}

export type ProjectAssistantTextAttachmentValidationCode =
  | 'PROJECT_ASSISTANT_TEXT_ATTACHMENT_SIZE_LIMIT_EXCEEDED'
  | 'PROJECT_ASSISTANT_TEXT_ATTACHMENT_UNSUPPORTED_TYPE'
  | 'UPLOAD_FILE_EMPTY'

export function validateProjectAssistantTextAttachmentFile(
  file: File,
): ProjectAssistantTextAttachmentValidationCode | null {
  if (file.size <= 0) return 'UPLOAD_FILE_EMPTY'
  if (file.size > PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_SIZE_BYTES) {
    return 'PROJECT_ASSISTANT_TEXT_ATTACHMENT_SIZE_LIMIT_EXCEEDED'
  }
  return /\.(txt|md|markdown|docx)$/i.test(file.name)
    ? null
    : 'PROJECT_ASSISTANT_TEXT_ATTACHMENT_UNSUPPORTED_TYPE'
}

function isAttachmentUploadResponse(value: unknown): value is ProjectAssistantTextAttachmentUploadResponse {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && 'attachment' in value
}

export async function uploadProjectAssistantTextAttachment({
  file,
}: UploadProjectAssistantTextAttachmentParams): Promise<ProjectAssistantTextAttachment> {
  const formData = new FormData()
  formData.set('file', file)
  const response = await apiFetch('/api/assistant/text-attachments', {
    method: 'POST',
    body: formData,
  })
  if (!response.ok) {
    throw await readClientApiError(response)
  }
  const payload: unknown = await response.json()
  if (!isAttachmentUploadResponse(payload)) {
    throw new Error('PROJECT_ASSISTANT_TEXT_ATTACHMENT_UPLOAD_RESPONSE_INVALID')
  }
  return payload.attachment
}
