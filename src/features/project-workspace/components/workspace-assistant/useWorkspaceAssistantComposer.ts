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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const scopeKeyRef = useRef(scopeKey)
  scopeKeyRef.current = scopeKey

  useEffect(() => {
    scopeKeyRef.current = scopeKey
    setText('')
    setAttachments([])
    setMediaAttachments([])
  }, [scopeKey])

  const submit = useCallback(async (options?: {
    readonly extraMediaAttachments?: readonly ProjectAssistantMediaAttachment[]
  }) => {
    const submitScopeKey = scopeKey
    const normalizedText = text.trim()
    const extras = (options?.extraMediaAttachments ?? []).filter((extra) => (
      !mediaAttachments.some((item) => item.resourceId === extra.resourceId)
    ))
    const mergedMediaAttachments = [...mediaAttachments, ...extras]
      .slice(0, PROJECT_ASSISTANT_MEDIA_ATTACHMENT_MAX_FILES)
    if (!normalizedText && attachments.length === 0 && mergedMediaAttachments.length === 0) return
    setText('')
    setAttachments([])
    setMediaAttachments([])
    try {
      await sendMessage({
        text: normalizedText,
        attachments,
        mediaAttachments: mergedMediaAttachments,
      })
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

  const applyDraftRequest = useCallback((input: {
    readonly text: string | null
    readonly focus: boolean
  }) => {
    const nextText = input.text?.trim() ?? ''
    if (nextText) {
      setText((current) => {
        const normalized = current.trimEnd()
        return normalized ? `${normalized}\n${nextText}` : nextText
      })
    }
    if (input.focus) {
      globalThis.requestAnimationFrame?.(() => {
        const textarea = textareaRef.current
        if (!textarea) return
        textarea.focus()
        textarea.setSelectionRange(textarea.value.length, textarea.value.length)
      })
    }
  }, [])

  return {
    text,
    setText,
    textareaRef,
    applyDraftRequest,
    attachments,
    mediaAttachments,
    submit,
    addAttachment,
    removeAttachment,
    addMediaAttachment,
    removeMediaAttachment,
  } as const
}
