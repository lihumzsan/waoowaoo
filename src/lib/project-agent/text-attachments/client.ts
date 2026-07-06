import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import type {
  ProjectAssistantTextAttachment,
  ProjectAssistantTextAttachmentUploadResponse,
} from './types'

interface UploadProjectAssistantTextAttachmentParams {
  readonly file: File
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
    throw new Error(await readApiErrorMessage(response, 'Failed to upload file'))
  }
  const payload: unknown = await response.json()
  if (!isAttachmentUploadResponse(payload)) {
    throw new Error('PROJECT_ASSISTANT_TEXT_ATTACHMENT_UPLOAD_RESPONSE_INVALID')
  }
  return payload.attachment
}
