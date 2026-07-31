'use client'

import { useCallback, useEffect, useRef } from 'react'
import type { ProjectAssistantTextAttachment } from '@/lib/project-agent/text-attachments'
import type { ProjectAssistantMediaAttachment } from '@/lib/project-agent/media-attachments'
import {
  isWorkspaceAssistantSendMessageEvent,
  releaseWorkspaceAssistantMessageKey,
  reserveWorkspaceAssistantMessageKey,
  WORKSPACE_ASSISTANT_SEND_MESSAGE_EVENT,
} from './assistant-send-event'
import type { WorkspaceAssistantSendMessageInput } from './useWorkspaceAssistantRuntime'

interface UseWorkspaceAssistantMessageDispatchParams {
  readonly autoStartDraft: {
    readonly message: string
    readonly attachments: readonly ProjectAssistantTextAttachment[]
    readonly mediaAttachments: readonly ProjectAssistantMediaAttachment[]
  } | null | undefined
  readonly autoStartKey: string | null | undefined
  readonly storageLoading: boolean
  readonly pending: boolean
  readonly onAutoStartConsumed?: () => void
  readonly sendMessage: (input: WorkspaceAssistantSendMessageInput) => Promise<void>
  readonly sendHiddenMessage: (text: string, sourceKey?: string) => Promise<void>
}

export function useWorkspaceAssistantMessageDispatch({
  autoStartDraft,
  autoStartKey,
  storageLoading,
  pending,
  onAutoStartConsumed,
  sendMessage,
  sendHiddenMessage,
}: UseWorkspaceAssistantMessageDispatchParams): void {
  const consumedMessageKeysRef = useRef<Set<string>>(new Set())
  const sendMessageOnce = useCallback(async (
    key: string,
    message: string,
    hidden = false,
    attachments: readonly ProjectAssistantTextAttachment[] = [],
    mediaAttachments: readonly ProjectAssistantMediaAttachment[] = [],
  ) => {
    const normalizedMessage = message.trim()
    if (!normalizedMessage && attachments.length === 0 && mediaAttachments.length === 0) return
    const reservedKey = reserveWorkspaceAssistantMessageKey(key, consumedMessageKeysRef.current)
    if (!reservedKey) return
    try {
      if (hidden) await sendHiddenMessage(normalizedMessage, reservedKey)
      else {
        await sendMessage({
          text: normalizedMessage,
          attachments,
          mediaAttachments,
          sourceKey: reservedKey,
        })
      }
    } catch (error) {
      releaseWorkspaceAssistantMessageKey(reservedKey, consumedMessageKeysRef.current)
      throw error
    }
  }, [sendHiddenMessage, sendMessage])

  useEffect(() => {
    if (!autoStartDraft || !autoStartKey || storageLoading || pending) return
    onAutoStartConsumed?.()
    void sendMessageOnce(
      autoStartKey,
      autoStartDraft.message,
      false,
      autoStartDraft.attachments,
      autoStartDraft.mediaAttachments,
    )
  }, [
    autoStartDraft,
    autoStartKey,
    onAutoStartConsumed,
    pending,
    sendMessageOnce,
    storageLoading,
  ])

  useEffect(() => {
    const handleSendMessage = (event: Event) => {
      if (!isWorkspaceAssistantSendMessageEvent(event)) return
      void sendMessageOnce(event.detail.key, event.detail.message, event.detail.hidden === true)
    }
    window.addEventListener(WORKSPACE_ASSISTANT_SEND_MESSAGE_EVENT, handleSendMessage)
    return () => window.removeEventListener(WORKSPACE_ASSISTANT_SEND_MESSAGE_EVENT, handleSendMessage)
  }, [sendMessageOnce])
}
