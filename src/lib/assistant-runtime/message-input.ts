import { safeValidateUIMessages, type UIMessage } from 'ai'
import { MAX_IMAGE_BYTES } from '@/lib/http/body-limits'
import { normalizeToOriginalMediaUrl } from '@/lib/media/outbound-image'
import type { RuntimeUserInput } from '@/lib/codex-runtime/runtime-adapter'
import {
  readProjectAssistantMediaAttachmentsFromMessage,
  withProjectAssistantMediaAttachments,
} from '@/lib/project-agent/media-attachments'
import {
  resolveProjectAssistantAttachmentRegistration,
  resolveProjectAssistantMediaAttachments,
} from '@/lib/project-agent/media-attachments/resolve'
import { ensureUniqueUIMessages } from '@/lib/project-agent/ui-message-validation'
import {
  appendProjectAssistantTextAttachmentsToUserText,
  readProjectAssistantTextAttachmentsFromMessage,
} from '@/lib/project-agent/text-attachments'
import type { AssistantRuntimePreparedInput } from './contracts'

const CODEX_SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])

function textFromMessage(message: UIMessage): string {
  return message.parts
    .filter((part): part is Extract<UIMessage['parts'][number], { type: 'text' }> => (
      part.type === 'text'
    ))
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join('\n\n')
}

function requireIdentity(value: string, code: string, maxLength = 191): string {
  const normalized = value.trim()
  if (!normalized || normalized !== value || normalized.length > maxLength) {
    throw new Error(code)
  }
  return normalized
}

function attachmentCapabilityText(input: {
  readonly name: string
  readonly resourceId: string
  readonly mediaType: 'image' | 'audio'
  readonly attachmentToken: string
}): string {
  return [
    '<uploaded_media_registration>',
    `name: ${JSON.stringify(input.name)}`,
    `media_type: ${input.mediaType}`,
    `resource_id: ${input.resourceId}`,
    `attachment_token: ${input.attachmentToken}`,
    'Use the Wao register_uploaded_media capability before treating this upload as a project Resource.',
    '</uploaded_media_registration>',
  ].join('\n')
}

export async function prepareAssistantRuntimeUserInput(input: {
  readonly message: unknown
  readonly userId: string
  readonly projectId: string
}): Promise<AssistantRuntimePreparedInput> {
  const validation = await safeValidateUIMessages({ messages: [input.message] })
  if (!validation.success) throw new Error('ASSISTANT_RUNTIME_USER_MESSAGE_INVALID')
  const [candidate] = ensureUniqueUIMessages(validation.data)
  if (!candidate || candidate.role !== 'user') {
    throw new Error('ASSISTANT_RUNTIME_USER_MESSAGE_INVALID')
  }
  requireIdentity(candidate.id, 'ASSISTANT_RUNTIME_USER_MESSAGE_ID_INVALID')

  const textAttachments = readProjectAssistantTextAttachmentsFromMessage(candidate)
  const proposedMedia = readProjectAssistantMediaAttachmentsFromMessage(candidate)
  const resolvedMedia = await resolveProjectAssistantMediaAttachments({
    userId: input.userId,
    projectId: input.projectId,
    refs: proposedMedia,
  })
  const message = withProjectAssistantMediaAttachments(candidate, resolvedMedia)
  const userText = appendProjectAssistantTextAttachmentsToUserText({
    userText: textFromMessage(message),
    attachments: textAttachments,
  })

  const runtimeInputs: RuntimeUserInput[] = []
  const registrationBlocks: string[] = []
  for (const attachment of resolvedMedia) {
    if (!attachment.attachmentToken) {
      throw new Error(
        `ASSISTANT_RUNTIME_MEDIA_ATTACHMENT_TOKEN_REQUIRED:${attachment.resourceId}`,
      )
    }
    const registration = await resolveProjectAssistantAttachmentRegistration({
      userId: input.userId,
      projectId: input.projectId,
      attachmentToken: attachment.attachmentToken,
    })
    if (registration.payload.resourceId !== attachment.resourceId) {
      throw new Error(
        `ASSISTANT_RUNTIME_MEDIA_ATTACHMENT_IDENTITY_DIVERGED:${attachment.resourceId}`,
      )
    }
    registrationBlocks.push(attachmentCapabilityText({
      name: registration.payload.name,
      resourceId: registration.payload.resourceId,
      mediaType: registration.payload.mediaType,
      attachmentToken: attachment.attachmentToken,
    }))
    if (registration.payload.mediaType !== 'image') continue
    const mimeType = registration.media.mimeType?.toLowerCase() ?? ''
    if (!CODEX_SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
      throw new Error(
        `ASSISTANT_RUNTIME_IMAGE_MIME_UNSUPPORTED:${registration.payload.resourceId}`,
      )
    }
    if (
      registration.media.sizeBytes !== null
      && registration.media.sizeBytes > MAX_IMAGE_BYTES
    ) {
      throw new Error(
        `ASSISTANT_RUNTIME_IMAGE_SIZE_EXCEEDED:${registration.payload.resourceId}`,
      )
    }
    runtimeInputs.push({
      type: 'image',
      url: await normalizeToOriginalMediaUrl(registration.media.storageKey),
      detail: 'high',
    })
  }

  const visibleText = [userText, ...registrationBlocks].filter(Boolean).join('\n\n')
  if (!visibleText && runtimeInputs.length === 0) {
    throw new Error('ASSISTANT_RUNTIME_USER_INPUT_EMPTY')
  }
  if (visibleText) runtimeInputs.unshift({ type: 'text', text: visibleText })
  return { message, inputs: runtimeInputs, visibleText }
}
