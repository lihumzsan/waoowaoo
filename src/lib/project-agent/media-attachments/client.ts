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
    && typeof payload.resource.revisionId === 'string'
    && (payload.mediaType === 'image' || payload.mediaType === 'audio')
    && typeof payload.name === 'string'
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
    revisionId: payload.resource.revisionId,
    mediaType: payload.mediaType,
    name: payload.name,
  }
}
