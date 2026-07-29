import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import type {
  ProjectAssistantMediaAttachment,
  ProjectAssistantMediaAttachmentUploadResponse,
} from './types'

interface UploadProjectAssistantMediaAttachmentParams {
  readonly projectId: string
  readonly file: File
}

function isMediaUploadResponse(value: unknown): value is ProjectAssistantMediaAttachmentUploadResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const payload = value as Partial<ProjectAssistantMediaAttachmentUploadResponse>
  const attachment = payload.attachment
  return payload.success === true
    && !!attachment
    && typeof attachment.resourceId === 'string'
    && typeof attachment.attachmentToken === 'string'
    && attachment.attachmentToken.length > 0
    && (attachment.mediaType === 'image' || attachment.mediaType === 'audio')
    && typeof attachment.name === 'string'
}

/**
 * Client-side routing only decides which upload endpoint receives a file; the
 * media endpoint re-sniffs magic bytes server-side and stays the sole
 * acceptance authority.
 */
export function isProjectAssistantMediaFile(file: File): boolean {
  const mimeType = file.type.toLowerCase()
  if (mimeType.startsWith('image/') || mimeType.startsWith('audio/')) return true
  return /\.(png|jpe?g|webp|mp3|wav|ogg)$/i.test(file.name)
}

export async function uploadProjectAssistantMediaAttachment({
  projectId,
  file,
}: UploadProjectAssistantMediaAttachmentParams): Promise<ProjectAssistantMediaAttachment> {
  const formData = new FormData()
  formData.set('file', file)
  const response = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/upload-media`, {
    method: 'POST',
    body: formData,
  })
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to upload media'))
  }
  const payload: unknown = await response.json()
  if (!isMediaUploadResponse(payload)) {
    throw new Error('PROJECT_ASSISTANT_MEDIA_ATTACHMENT_UPLOAD_RESPONSE_INVALID')
  }
  return {
    resourceId: payload.attachment.resourceId,
    attachmentToken: payload.attachment.attachmentToken,
    mediaType: payload.attachment.mediaType,
    name: payload.attachment.name,
    // Composer-only preview from the local file. Message acceptance strips
    // non-`/m/` hrefs, so this never persists beyond the composer session.
    href: payload.attachment.mediaType === 'image' && typeof URL !== 'undefined'
      ? URL.createObjectURL(file)
      : null,
  }
}
