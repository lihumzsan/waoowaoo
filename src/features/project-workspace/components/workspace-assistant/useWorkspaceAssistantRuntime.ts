'use client'

import { useChat } from '@ai-sdk/react'
import { AssistantChatTransport, useAISDKRuntime } from '@assistant-ui/react-ai-sdk'
import type { AssistantRuntime } from '@assistant-ui/react'
import {
  lastAssistantMessageIsCompleteWithToolCalls,
  type ChatStatus,
  type UIMessage,
} from 'ai'
import { useLocale } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  useProjectAssistantThread,
  useProjectAssistantThreadSync,
} from '@/lib/query/hooks'
import { ensureUniqueUIMessages, isPersistableUIMessages } from '@/lib/project-agent/ui-message-validation'
import {
  findPendingAgentInterruption,
  findPendingToolApprovalId,
} from '@/lib/project-agent/ui-message-approval'

interface UseWorkspaceAssistantRuntimeParams {
  projectId: string
  episodeId?: string
  selectedScopeRef?: string | null
  selectedPanelId?: string | null
  selectedClipId?: string | null
  selectedAssetId?: string | null
}

interface UseWorkspaceAssistantRuntimeResult {
  runtime: AssistantRuntime
  messages: UIMessage[]
  messageCount: number
  status: ChatStatus
  pending: boolean
  pendingApprovalId: string | null
  error: Error | undefined
  syncError: string | null
  storageError: string | null
  storageLoading: boolean
  sendMessage: (text: string) => Promise<void>
  sendHiddenMessage: (text: string) => Promise<void>
  addToolOutput: (params: {
    tool: string
    toolCallId: string
    output: unknown
  }) => Promise<void>
  addToolApprovalResponse: (params: {
    approvalId: string
    approved: boolean
    reason?: string
  }) => Promise<void>
  replaceMessages: (messages: UIMessage[]) => void
  appendMessages: (messages: UIMessage[]) => void
}

export function buildWorkspaceAssistantChatId(params: {
  projectId: string
  episodeId?: string
}): string {
  return `workspace-command:${params.projectId}:${params.episodeId || 'global'}`
}

export function useWorkspaceAssistantRuntime({
  projectId,
  episodeId,
  selectedScopeRef,
  selectedPanelId,
  selectedClipId,
  selectedAssetId,
}: UseWorkspaceAssistantRuntimeParams): UseWorkspaceAssistantRuntimeResult {
  const locale = useLocale()
  const chatId = buildWorkspaceAssistantChatId({
    projectId,
    episodeId,
  })
  const assistantThread = useProjectAssistantThread(projectId, episodeId)
  const { save: saveAssistantThread } = useProjectAssistantThreadSync(projectId, episodeId, locale)
  const contextPayload = useMemo(() => ({
    locale,
    projectId,
    episodeId,
    selectedScopeRef,
    selectedPanelId,
    selectedClipId,
    selectedAssetId,
  }), [episodeId, locale, projectId, selectedAssetId, selectedClipId, selectedPanelId, selectedScopeRef])
  const transport = useMemo(() => new AssistantChatTransport({
    api: `/api/projects/${projectId}/assistant/chat`,
    body: {
      context: contextPayload,
    },
  }), [contextPayload, projectId])
  const suppressNextAutomaticSendRef = useRef(false)
  const chat = useChat({
    id: chatId,
    transport,
    sendAutomaticallyWhen: ({ messages }) => {
      if (suppressNextAutomaticSendRef.current) {
        suppressNextAutomaticSendRef.current = false
        return false
      }
      return lastAssistantMessageIsCompleteWithToolCalls({ messages })
    },
  })
  const runtime = useAISDKRuntime(chat)
  const hydratedSessionKeyRef = useRef<string | null>(null)
  const lastPersistedSignatureRef = useRef('[]')
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve())
  const persistTimerRef = useRef<number | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)

  const replaceMessages = useCallback((messages: UIMessage[]) => {
    chat.setMessages(ensureUniqueUIMessages(messages))
  }, [chat])

  const sendAgentApprovalResponse = useCallback(async (params: {
    approvalId: string
    approved: boolean
    reason?: string
  }) => {
    const interruption = findPendingAgentInterruption(chat.messages, params.approvalId)
    if (!interruption) {
      throw new Error('PROJECT_AGENT_INTERRUPTION_NOT_FOUND')
    }
    await chat.sendMessage({
      text: params.approved ? 'Tool approval accepted.' : 'Tool approval rejected.',
      metadata: {
        custom: {
          workspaceAssistantHidden: true,
          projectAgentApprovalResponse: {
            approvalId: params.approvalId,
            approved: params.approved,
            runState: interruption.runState,
            ...(params.reason ? { reason: params.reason } : {}),
          },
        },
      },
    })
  }, [chat])

  const cancelPendingApprovalBeforeUserMessage = useCallback(async () => {
    const interruption = findPendingAgentInterruption(chat.messages)
    if (!interruption) return
    await sendAgentApprovalResponse({
      approvalId: interruption.approvalId,
      approved: false,
      reason: 'user_interrupted',
    })
  }, [chat.messages, sendAgentApprovalResponse])

  const sendMessage = useCallback(async (text: string) => {
    chat.clearError()
    await cancelPendingApprovalBeforeUserMessage()
    await chat.sendMessage({ text })
  }, [cancelPendingApprovalBeforeUserMessage, chat])

  const sendHiddenMessage = useCallback(async (text: string) => {
    chat.clearError()
    await chat.sendMessage({
      text,
      metadata: {
        custom: {
          workspaceAssistantHidden: true,
        },
      },
    })
  }, [chat])

  const appendMessages = useCallback((messages: UIMessage[]) => {
    if (messages.length === 0) return
    chat.setMessages((current) => ensureUniqueUIMessages([...current, ...messages]))
  }, [chat])

  const addToolOutput = useCallback(async (params: {
    tool: string
    toolCallId: string
    output: unknown
  }) => {
    chat.clearError()
    await chat.addToolOutput({
      tool: params.tool,
      toolCallId: params.toolCallId,
      output: params.output,
    })
  }, [chat])

  const addToolApprovalResponse = useCallback(async (params: {
    approvalId: string
    approved: boolean
    reason?: string
  }) => {
    chat.clearError()
    await sendAgentApprovalResponse(params)
  }, [chat, sendAgentApprovalResponse])

  useEffect(() => {
    if (assistantThread.isLoading) return
    if (hydratedSessionKeyRef.current === chatId) return
    const persistedMessages = ensureUniqueUIMessages(assistantThread.data?.messages || [])
    const persistedMessageIds = new Set(persistedMessages.map((message) => message.id))
    const mergedMessages = ensureUniqueUIMessages(chat.messages.length > 0
      ? [...persistedMessages, ...chat.messages.filter((message) => !persistedMessageIds.has(message.id))]
      : persistedMessages)
    replaceMessages(mergedMessages)
    hydratedSessionKeyRef.current = chatId
    lastPersistedSignatureRef.current = JSON.stringify(persistedMessages)
  }, [assistantThread.data, assistantThread.isLoading, chat.messages, chatId, replaceMessages])

  useEffect(() => {
    if (hydratedSessionKeyRef.current !== chatId) return
    if (chat.status === 'submitted' || chat.status === 'streaming') return
    if (!isPersistableUIMessages(chat.messages)) return
    const signature = JSON.stringify(chat.messages)
    if (signature === lastPersistedSignatureRef.current) return
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current)
    }
    persistTimerRef.current = window.setTimeout(() => {
      const nextMessages = chat.messages
      const nextSignature = JSON.stringify(nextMessages)
      persistQueueRef.current = persistQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          try {
            await saveAssistantThread(nextMessages)
            lastPersistedSignatureRef.current = nextSignature
            setSyncError(null)
          } catch (error) {
            setSyncError(error instanceof Error ? error.message : String(error))
          }
        })
    }, 400)

    return () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current)
        persistTimerRef.current = null
      }
    }
  }, [chat.messages, chat.status, chatId, saveAssistantThread])

  useEffect(() => {
    return () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current)
      }
    }
  }, [])

  return {
    runtime,
    messages: chat.messages,
    messageCount: chat.messages.length,
    status: chat.status,
    pending: chat.status === 'submitted' || chat.status === 'streaming',
    pendingApprovalId: findPendingToolApprovalId(chat.messages),
    error: chat.error,
    syncError,
    storageError: assistantThread.error?.message || null,
    storageLoading: assistantThread.isLoading,
    sendMessage,
    sendHiddenMessage,
    addToolOutput,
    addToolApprovalResponse,
    replaceMessages,
    appendMessages,
  }
}
