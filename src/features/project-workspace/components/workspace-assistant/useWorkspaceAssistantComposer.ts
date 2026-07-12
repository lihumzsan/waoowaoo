'use client'

import { useCallback, useState } from 'react'
import {
  PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_FILES,
  type ProjectAssistantTextAttachment,
} from '@/lib/project-agent/text-attachments'
import type { WorkspaceAssistantSendMessageInput } from './useWorkspaceAssistantRuntime'

export function useWorkspaceAssistantComposer(
  sendMessage: (input: WorkspaceAssistantSendMessageInput) => Promise<void>,
) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<ProjectAssistantTextAttachment[]>([])
  const [attachmentDialogOpen, setAttachmentDialogOpen] = useState(false)

  const submit = useCallback(async () => {
    const normalizedText = text.trim()
    if (!normalizedText && attachments.length === 0) return
    setText('')
    setAttachments([])
    try {
      await sendMessage({ text: normalizedText, attachments })
    } catch (error) {
      setText(normalizedText)
      setAttachments([...attachments])
      throw error
    }
  }, [attachments, sendMessage, text])

  const addAttachment = useCallback((attachment: ProjectAssistantTextAttachment) => {
    setAttachments((current) => {
      if (current.length >= PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_FILES) return current
      return [...current, attachment]
    })
  }, [])

  const removeAttachment = useCallback((attachmentId: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId))
  }, [])

  return {
    text,
    setText,
    attachments,
    attachmentDialogOpen,
    setAttachmentDialogOpen,
    submit,
    addAttachment,
    removeAttachment,
  } as const
}
