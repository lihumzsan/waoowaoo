import type { ProjectAssistantTextAttachment } from './types'

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
}

function escapeTagAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function formatProjectAssistantTextAttachmentsForModel(input: {
  readonly attachments: readonly ProjectAssistantTextAttachment[]
}): string {
  if (input.attachments.length === 0) return ''
  const blocks = input.attachments.map((attachment, index) => {
    const body = normalizeText(attachment.normalizedText)
    const tagFileName = escapeTagAttribute(attachment.fileName)
    return [
      `Uploaded file ${String(index + 1)}:`,
      `File name: ${attachment.fileName}`,
      `Content:`,
      `<uploaded_file name="${tagFileName}">`,
      body,
      '</uploaded_file>',
    ].join('\n')
  })
  return blocks.join('\n\n')
}

export function appendProjectAssistantTextAttachmentsToUserText(input: {
  readonly userText: string
  readonly attachments: readonly ProjectAssistantTextAttachment[]
}): string {
  const userText = normalizeText(input.userText)
  const attachmentText = formatProjectAssistantTextAttachmentsForModel({
    attachments: input.attachments,
  })
  return [userText, attachmentText].filter(Boolean).join('\n\n')
}
