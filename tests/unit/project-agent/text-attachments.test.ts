import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import {
  appendProjectAssistantTextAttachmentsToUserText,
  buildProjectAssistantTextAttachmentMetadata,
  readProjectAssistantTextAttachmentsFromMessage,
  type ProjectAssistantTextAttachment,
} from '@/lib/project-agent/text-attachments'

function buildAttachment(overrides: Partial<ProjectAssistantTextAttachment> = {}): ProjectAssistantTextAttachment {
  const normalizedText = overrides.normalizedText ?? '第一幕\n角色进入房间'
  return {
    id: overrides.id ?? 'attachment-1',
    kind: overrides.kind ?? 'docx',
    fileName: overrides.fileName ?? 'story.docx',
    mimeType: overrides.mimeType ?? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sizeBytes: overrides.sizeBytes ?? 128,
    checksum: overrides.checksum ?? 'a'.repeat(64),
    charCount: overrides.charCount ?? normalizedText.length,
    normalizedText,
  }
}

describe('project assistant text attachments', () => {
  it('formats uploaded files as explicit model context instead of merging them into user text', () => {
    const prompt = appendProjectAssistantTextAttachmentsToUserText({
      locale: 'zh',
      userText: '请分析这个剧本',
      attachments: [buildAttachment()],
    })

    expect(prompt).toContain('请分析这个剧本')
    expect(prompt).toContain('用户上传文件 1：')
    expect(prompt).toContain('文件名：story.docx')
    expect(prompt).toContain('<uploaded_file name="story.docx">')
    expect(prompt).toContain('第一幕\n角色进入房间')
  })

  it('formats file-only uploads without visible user text and escapes file boundary attributes', () => {
    const prompt = appendProjectAssistantTextAttachmentsToUserText({
      locale: 'en',
      userText: '',
      attachments: [buildAttachment({ fileName: 'draft "A"<final>.docx' })],
    })

    expect(prompt).toContain('Uploaded file 1:')
    expect(prompt).toContain('File name: draft "A"<final>.docx')
    expect(prompt).toContain('<uploaded_file name="draft &quot;A&quot;&lt;final&gt;.docx">')
    expect(prompt).not.toContain('Uploaded file(s).')
  })

  it('stores attachment payloads in message metadata for UI chips and server-side model expansion', () => {
    const attachment = buildAttachment()
    const message: UIMessage = {
      id: 'message-1',
      role: 'user',
      parts: [{ type: 'text', text: '开始生成' }],
      metadata: buildProjectAssistantTextAttachmentMetadata([attachment]),
    }

    expect(readProjectAssistantTextAttachmentsFromMessage(message)).toEqual([attachment])
  })

  it('rejects attachment metadata when charCount no longer matches normalized text', () => {
    const message: UIMessage = {
      id: 'message-1',
      role: 'user',
      parts: [{ type: 'text', text: '开始生成' }],
      metadata: buildProjectAssistantTextAttachmentMetadata([
        buildAttachment({ charCount: 1 }),
      ]),
    }

    expect(() => readProjectAssistantTextAttachmentsFromMessage(message)).toThrow(
      'PROJECT_ASSISTANT_TEXT_ATTACHMENT_INVALID',
    )
  })
})
