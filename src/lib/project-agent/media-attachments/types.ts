export const PROJECT_ASSISTANT_MEDIA_ATTACHMENT_METADATA_KEY = 'projectAssistantMediaAttachments' as const

export const PROJECT_ASSISTANT_MEDIA_ATTACHMENT_ACCEPT = [
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.mp3',
  '.wav',
  '.ogg',
  'image/png',
  'image/jpeg',
  'image/webp',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
].join(',')

export const PROJECT_ASSISTANT_MEDIA_ATTACHMENT_MAX_FILES = 8

export type ProjectAssistantMediaAttachmentMediaType = 'image' | 'audio'

/**
 * One user-attached media item on a chat message. Only the exact Resource
 * revision identity travels with the message; name, mediaType and the
 * protected `/m/` href are server-resolved at message acceptance from the
 * owned Resource, never trusted from the client. The href exists for UI
 * previews only and is never shown to the model.
 */
export interface ProjectAssistantMediaAttachment {
  readonly resourceId: string
  readonly revisionId: string
  readonly mediaType: ProjectAssistantMediaAttachmentMediaType
  readonly name: string
  readonly href: string | null
}

export interface ProjectAssistantMediaAttachmentUploadResponse {
  readonly success: true
  readonly resource: {
    readonly resourceId: string
    readonly revisionId: string
  }
  readonly mediaType: ProjectAssistantMediaAttachmentMediaType
  readonly schemaId: string
  readonly name: string
  readonly href: string
  readonly reused: boolean
}
