import type { UIMessage } from 'ai'
import {
  PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_CHARS,
  PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_FILES,
  PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_SIZE_BYTES,
  PROJECT_ASSISTANT_TEXT_ATTACHMENT_METADATA_KEY,
  type ProjectAssistantTextAttachment,
  type ProjectAssistantTextAttachmentKind,
} from './types'

type UnknownObject = { [key: string]: unknown }

function isRecord(value: unknown): value is UnknownObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isAttachmentKind(value: unknown): value is ProjectAssistantTextAttachmentKind {
  return value === 'txt' || value === 'markdown' || value === 'docx'
}

function readFiniteNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function readAttachment(value: unknown): ProjectAssistantTextAttachment | null {
  if (!isRecord(value)) return null
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  const fileName = typeof value.fileName === 'string' ? value.fileName.trim() : ''
  const mimeType = typeof value.mimeType === 'string' ? value.mimeType.trim() : ''
  const checksum = typeof value.checksum === 'string' ? value.checksum.trim() : ''
  const normalizedText = typeof value.normalizedText === 'string' ? value.normalizedText.trim() : ''
  const sizeBytes = readFiniteNonNegativeNumber(value.sizeBytes)
  const charCount = readFiniteNonNegativeNumber(value.charCount)

  if (!id || !fileName || !isAttachmentKind(value.kind) || !checksum || !normalizedText) return null
  if (sizeBytes === null || sizeBytes > PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_SIZE_BYTES) return null
  if (charCount === null || charCount <= 0 || charCount > PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_CHARS) return null
  if (normalizedText.length !== charCount) return null

  return {
    id,
    kind: value.kind,
    fileName,
    mimeType,
    sizeBytes,
    checksum,
    charCount,
    normalizedText,
  }
}

export function readProjectAssistantTextAttachmentsFromMetadata(metadata: unknown): ProjectAssistantTextAttachment[] {
  if (!isRecord(metadata)) return []
  const custom = metadata.custom
  if (!isRecord(custom)) return []
  const rawAttachments = custom[PROJECT_ASSISTANT_TEXT_ATTACHMENT_METADATA_KEY]
  if (rawAttachments === undefined) return []
  if (!Array.isArray(rawAttachments)) {
    throw new Error('PROJECT_ASSISTANT_TEXT_ATTACHMENTS_INVALID')
  }
  if (rawAttachments.length > PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_FILES) {
    throw new Error('PROJECT_ASSISTANT_TEXT_ATTACHMENTS_TOO_MANY')
  }
  return rawAttachments.map((value) => {
    const attachment = readAttachment(value)
    if (!attachment) throw new Error('PROJECT_ASSISTANT_TEXT_ATTACHMENT_INVALID')
    return attachment
  })
}

export function readProjectAssistantTextAttachmentsFromMessage(message: Pick<UIMessage, 'metadata'>): ProjectAssistantTextAttachment[] {
  return readProjectAssistantTextAttachmentsFromMetadata(message.metadata)
}

export function buildProjectAssistantTextAttachmentMetadata(
  attachments: readonly ProjectAssistantTextAttachment[],
): UIMessage['metadata'] | undefined {
  if (attachments.length === 0) return undefined
  if (attachments.length > PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_FILES) {
    throw new Error('PROJECT_ASSISTANT_TEXT_ATTACHMENTS_TOO_MANY')
  }
  return {
    custom: {
      [PROJECT_ASSISTANT_TEXT_ATTACHMENT_METADATA_KEY]: attachments,
    },
  } satisfies UIMessage['metadata']
}
