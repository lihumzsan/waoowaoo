'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_FILES,
  type ProjectAssistantTextAttachment,
} from '@/lib/project-agent/text-attachments'
import {
  PROJECT_ASSISTANT_MEDIA_ATTACHMENT_MAX_FILES,
  type ProjectAssistantMediaAttachment,
} from '@/lib/project-agent/media-attachments'
import type { WorkspaceAssistantSendMessageInput } from './useWorkspaceAssistantRuntime'

export function useWorkspaceAssistantComposer(
  sendMessage: (input: WorkspaceAssistantSendMessageInput) => Promise<void>,
  scopeKey: string,
) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<ProjectAssistantTextAttachment[]>([])
  const [mediaAttachments, setMediaAttachments] = useState<ProjectAssistantMediaAttachment[]>([])
  const scopeKeyRef = useRef(scopeKey)
  scopeKeyRef.current = scopeKey

  useEffect(() => {
    scopeKeyRef.current = scopeKey
    setText('')
    setAttachments([])
    setMediaAttachments([])
  }, [scopeKey])

  const submit = useCallback(async () => {
    const submitScopeKey = scopeKey
    const normalizedText = text.trim()
    if (!normalizedText && attachments.length === 0 && mediaAttachments.length === 0) return
    setText('')
    setAttachments([])
    setMediaAttachments([])
    try {
      await sendMessage({ text: normalizedText, attachments, mediaAttachments })
    } catch (error) {
      if (scopeKeyRef.current === submitScopeKey) {
        setText(normalizedText)
        setAttachments([...attachments])
        setMediaAttachments([...mediaAttachments])
      }
      throw error
    }
  }, [attachments, mediaAttachments, scopeKey, sendMessage, text])

  const addAttachment = useCallback((attachment: ProjectAssistantTextAttachment) => {
    setAttachments((current) => {
      if (current.length >= PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_FILES) return current
      return [...current, attachment]
    })
  }, [])

  const removeAttachment = useCallback((attachmentId: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId))
  }, [])

  const addMediaAttachment = useCallback((attachment: ProjectAssistantMediaAttachment) => {
    setMediaAttachments((current) => {
      if (current.length >= PROJECT_ASSISTANT_MEDIA_ATTACHMENT_MAX_FILES) return current
      if (current.some((item) => item.resourceId === attachment.resourceId)) return current
      return [...current, attachment]
    })
  }, [])

  const removeMediaAttachment = useCallback((resourceId: string) => {
    setMediaAttachments((current) =>
      current.filter((attachment) => attachment.resourceId !== resourceId),
    )
  }, [])

  return {
    text,
    setText,
    attachments,
    mediaAttachments,
    submit,
    addAttachment,
    removeAttachment,
    addMediaAttachment,
    removeMediaAttachment,
  } as const
}
