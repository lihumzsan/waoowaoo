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
 * One user-attached media item on a chat message: a chat-scoped attachment,
 * not a project Resource. Upload only registers bytes plus the shared
 * MediaObject and issues a signed registration receipt (`attachmentToken`)
 * binding owner, project and media identity. `resourceId` is the canonical
 * domain Resource id this attachment materializes to when the Agent registers
 * it through the dedicated operation — the row may not exist yet.
 *
 * `attachmentToken` is null only for attachments persisted under the retired
 * resource-backed protocol; every write/model consumer must fail those
 * explicitly. `href` is a client-side preview URL only (object URL in the
 * composer); it is stripped at message acceptance and never shown to the
 * model.
 */
export interface ProjectAssistantMediaAttachment {
  readonly resourceId: string
  readonly attachmentToken: string | null
  readonly mediaType: ProjectAssistantMediaAttachmentMediaType
  readonly name: string
  readonly href: string | null
}

export interface ProjectAssistantMediaAttachmentUploadResponse {
  readonly success: true
  readonly attachment: {
    readonly resourceId: string
    readonly attachmentToken: string
    readonly mediaType: ProjectAssistantMediaAttachmentMediaType
    readonly name: string
  }
}
