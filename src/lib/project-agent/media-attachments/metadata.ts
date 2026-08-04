import type { UIMessage } from 'ai'
import {
  PROJECT_ASSISTANT_MEDIA_ATTACHMENT_MAX_FILES,
  PROJECT_ASSISTANT_MEDIA_ATTACHMENT_METADATA_KEY,
  type ProjectAssistantMediaAttachment,
  type ProjectAssistantMediaAttachmentMediaType,
} from './types'

type UnknownObject = { [key: string]: unknown }

function isRecord(value: unknown): value is UnknownObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isMediaType(value: unknown): value is ProjectAssistantMediaAttachmentMediaType {
  return value === 'image' || value === 'audio'
}

function readAttachment(value: unknown): ProjectAssistantMediaAttachment | null {
  if (!isRecord(value)) return null
  const resourceId = typeof value.resourceId === 'string' ? value.resourceId.trim() : ''
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  const href = typeof value.href === 'string' && value.href.startsWith('/m/') ? value.href : null
  // Legacy resource-backed attachments (retired protocol) persist in immutable
  // message history without a token. They stay displayable, but every write or
  // model consumer must reject a null token explicitly.
  const attachmentToken = typeof value.attachmentToken === 'string' && value.attachmentToken.trim()
    ? value.attachmentToken.trim()
    : null
  if (!resourceId || !name || !isMediaType(value.mediaType)) return null
  return {
    resourceId,
    attachmentToken,
    mediaType: value.mediaType,
    name,
    href,
  }
}

export function readProjectAssistantMediaAttachmentsFromMetadata(
  metadata: unknown,
): ProjectAssistantMediaAttachment[] {
  if (!isRecord(metadata)) return []
  const custom = metadata.custom
  if (!isRecord(custom)) return []
  const rawAttachments = custom[PROJECT_ASSISTANT_MEDIA_ATTACHMENT_METADATA_KEY]
  if (rawAttachments === undefined) return []
  if (!Array.isArray(rawAttachments)) {
    throw new Error('PROJECT_ASSISTANT_MEDIA_ATTACHMENTS_INVALID')
  }
  if (rawAttachments.length > PROJECT_ASSISTANT_MEDIA_ATTACHMENT_MAX_FILES) {
    throw new Error('PROJECT_ASSISTANT_MEDIA_ATTACHMENTS_TOO_MANY')
  }
  return rawAttachments.map((value) => {
    const attachment = readAttachment(value)
    if (!attachment) throw new Error('PROJECT_ASSISTANT_MEDIA_ATTACHMENT_INVALID')
    return attachment
  })
}

export function readProjectAssistantMediaAttachmentsFromMessage(
  message: Pick<UIMessage, 'metadata'>,
): ProjectAssistantMediaAttachment[] {
  return readProjectAssistantMediaAttachmentsFromMetadata(message.metadata)
}

export function buildProjectAssistantMediaAttachmentMetadata(
  attachments: readonly ProjectAssistantMediaAttachment[],
): UIMessage['metadata'] | undefined {
  if (attachments.length === 0) return undefined
  if (attachments.length > PROJECT_ASSISTANT_MEDIA_ATTACHMENT_MAX_FILES) {
    throw new Error('PROJECT_ASSISTANT_MEDIA_ATTACHMENTS_TOO_MANY')
  }
  return {
    custom: {
      [PROJECT_ASSISTANT_MEDIA_ATTACHMENT_METADATA_KEY]: attachments,
    },
  } satisfies UIMessage['metadata']
}

/**
 * Merge the `custom` payloads of independently built attachment metadata
 * objects (text attachments, media attachments) into one message metadata
 * value, so each attachment kind keeps its own builder and vocabulary.
 */
export function mergeProjectAssistantMessageMetadata(
  ...parts: readonly (UIMessage['metadata'] | undefined)[]
): UIMessage['metadata'] | undefined {
  const custom: UnknownObject = {}
  for (const part of parts) {
    if (!isRecord(part)) continue
    const partCustom = part.custom
    if (!isRecord(partCustom)) continue
    Object.assign(custom, partCustom)
  }
  if (Object.keys(custom).length === 0) return undefined
  return { custom } satisfies UIMessage['metadata']
}

/**
 * Replace the message's media attachment entries with the server-resolved
 * list, keeping every other metadata key untouched. Called at message
 * acceptance so persisted metadata only ever carries authoritative values.
 */
export function withProjectAssistantMediaAttachments<Message extends Pick<UIMessage, 'metadata'>>(
  message: Message,
  attachments: readonly ProjectAssistantMediaAttachment[],
): Message {
  const metadata = isRecord(message.metadata) ? message.metadata : {}
  const custom = isRecord(metadata.custom) ? metadata.custom : {}
  return {
    ...message,
    metadata: {
      ...metadata,
      custom: {
        ...custom,
        [PROJECT_ASSISTANT_MEDIA_ATTACHMENT_METADATA_KEY]: attachments,
      },
    },
  }
}
