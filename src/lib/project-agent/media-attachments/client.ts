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
  return payload.success === true
    && !!payload.resource
    && typeof payload.resource.resourceId === 'string'
    && (payload.mediaType === 'image' || payload.mediaType === 'audio')
    && typeof payload.name === 'string'
    && typeof payload.href === 'string'
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
    resourceId: payload.resource.resourceId,
    mediaType: payload.mediaType,
    name: payload.name,
    href: payload.href,
  }
}
