import { apiFetch } from '@/lib/api-fetch'
import { readClientApiError } from '@/lib/errors/client'
import type {
  ProjectAssistantMediaAttachment,
  ProjectAssistantMediaAttachmentUploadResponse,
} from './types'
import { MAX_AUDIO_BYTES, MAX_IMAGE_BYTES } from '@/lib/http/body-size-constants'

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
  if ([
    'image/png',
    'image/jpeg',
    'image/webp',
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
  ].includes(mimeType)) return true
  return /\.(png|jpe?g|webp|mp3|wav|ogg)$/i.test(file.name)
}

export type ProjectAssistantMediaAttachmentValidationCode =
  | 'PROJECT_ASSISTANT_MEDIA_ATTACHMENT_SIZE_LIMIT_EXCEEDED'
  | 'PROJECT_ASSISTANT_MEDIA_ATTACHMENT_UNSUPPORTED_TYPE'
  | 'UPLOAD_FILE_EMPTY'

export function validateProjectAssistantMediaAttachmentFile(
  file: File,
): ProjectAssistantMediaAttachmentValidationCode | null {
  if (file.size <= 0) return 'UPLOAD_FILE_EMPTY'
  if (!isProjectAssistantMediaFile(file)) {
    return 'PROJECT_ASSISTANT_MEDIA_ATTACHMENT_UNSUPPORTED_TYPE'
  }
  const isImage = file.type.toLowerCase().startsWith('image/')
    || /\.(png|jpe?g|webp)$/i.test(file.name)
  if (file.size > (isImage ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES)) {
    return 'PROJECT_ASSISTANT_MEDIA_ATTACHMENT_SIZE_LIMIT_EXCEEDED'
  }
  return null
}

interface MintProjectAssistantResourceAttachmentParams {
  readonly projectId: string
  readonly resourceId: string
  /** Composer-only preview URL for the chip/thumb; never persisted. */
  readonly previewUrl: string | null
}

/**
 * Issues a signed attachment receipt for an existing project image Resource
 * (the canvas selection), so it enters the message exactly like an uploaded
 * attachment. The server is the only token authority; this is a plain fetch.
 */
export async function mintProjectAssistantResourceAttachment({
  projectId,
  resourceId,
  previewUrl,
}: MintProjectAssistantResourceAttachmentParams): Promise<ProjectAssistantMediaAttachment> {
  const response = await apiFetch(
    `/api/projects/${encodeURIComponent(projectId)}/assistant/resource-attachments`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceId }),
    },
  )
  if (!response.ok) {
    throw await readClientApiError(response)
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
    href: previewUrl,
  }
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
    throw await readClientApiError(response)
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
