import type { ProjectAgentLocale } from '../locale'
import type { ProjectAssistantMediaAttachment } from './types'

function escapeTagAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function formatProjectAssistantMediaAttachmentsForModel(input: {
  readonly locale: ProjectAgentLocale
  readonly attachments: readonly ProjectAssistantMediaAttachment[]
}): string {
  if (input.attachments.length === 0) return ''
  const blocks = input.attachments.map((attachment, index) => {
    const tag = `<uploaded_media name="${escapeTagAttribute(attachment.name)}" mediaType="${attachment.mediaType}" resourceId="${escapeTagAttribute(attachment.resourceId)}" />`
    if (input.locale === 'en') {
      return `Uploaded media ${String(index + 1)}:\n${tag}`
    }
    return `用户上传素材 ${String(index + 1)}：\n${tag}`
  })
  const hint = input.locale === 'en'
    ? 'These are ready Resources owned by the user. To use one in generation, pass its resourceId into the matching typed reference parameter (for example create_video.imageReferences, create_video.audioReferences, create_audio.videoReference, or create_image.imageReferences).'
    : '以上是用户已拥有的 ready Resource。如需在生成中使用，请把对应 resourceId 传入相应的类型化引用参数（例如 create_video.imageReferences、create_video.audioReferences、create_audio.videoReference 或 create_image.imageReferences）。'
  return [...blocks, hint].join('\n\n')
}

export function appendProjectAssistantMediaAttachmentsToUserText(input: {
  readonly locale: ProjectAgentLocale
  readonly userText: string
  readonly attachments: readonly ProjectAssistantMediaAttachment[]
}): string {
  const attachmentText = formatProjectAssistantMediaAttachmentsForModel({
    locale: input.locale,
    attachments: input.attachments,
  })
  return [input.userText.trim(), attachmentText].filter(Boolean).join('\n\n')
}
