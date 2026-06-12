'use client'

import { useChat } from '@ai-sdk/react'
import { AssistantChatTransport, useAISDKRuntime } from '@assistant-ui/react-ai-sdk'
import type { AssistantRuntime } from '@assistant-ui/react'
import {
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
  collectResolvedInterruptionApprovalIds,
  findPendingToolApprovalId,
  findPendingWorkspaceAssistantInterruption,
} from './interruption-parts'
import type { AssistantPermissionMode } from '@/lib/project-agent/permission-mode'

export type WorkspaceAssistantChoiceType = 'duration_and_aspect_ratio' | 'screenplay_review' | 'style'

interface UseWorkspaceAssistantRuntimeParams {
  projectId: string
  episodeId?: string
  selectedScopeRef?: string | null
  selectedPanelId?: string | null
  selectedClipId?: string | null
  selectedAssetId?: string | null
  assistantPermissionMode: AssistantPermissionMode
}

interface UseWorkspaceAssistantRuntimeResult {
  runtime: AssistantRuntime
  messages: UIMessage[]
  messageCount: number
  status: ChatStatus
  pending: boolean
  pendingApprovalId: string | null
  approvalRespondedIds: ReadonlySet<string>
  error: Error | undefined
  syncError: string | null
  storageError: string | null
  storageLoading: boolean
  sendMessage: (text: string) => Promise<void>
  sendHiddenMessage: (text: string) => Promise<void>
  submitChoiceResponse: (params: {
    choiceType: WorkspaceAssistantChoiceType
    toolCallId: string | null
    output: Record<string, unknown>
  }) => Promise<void>
  submitTaskFollowUp: (params: {
    waitId: string
    claimId: string
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
  assistantPermissionMode,
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
      assistantPermissionMode,
    },
  }), [assistantPermissionMode, contextPayload, projectId])
  const chat = useChat({
    id: chatId,
    transport,
    sendAutomaticallyWhen: shouldSendWorkspaceAssistantAutomatically,
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

  // The user's new message supersedes any pending approval server-side; the
  // stream answers with an interruption-resolved part so the card closes.
  const sendMessage = useCallback(async (text: string) => {
    chat.clearError()
    await chat.sendMessage({ text })
  }, [chat])

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

  const submitChoiceResponse = useCallback(async (params: {
    choiceType: WorkspaceAssistantChoiceType
    toolCallId: string | null
    output: Record<string, unknown>
  }) => {
    chat.clearError()
    await chat.sendMessage({
      text: '',
      metadata: {
        custom: {
          workspaceAssistantHidden: true,
        },
      },
    }, {
      body: {
        control: {
          type: 'choice_response',
          choiceType: params.choiceType,
          toolCallId: params.toolCallId,
          output: params.output,
        },
      },
    })
  }, [chat])

  const submitTaskFollowUp = useCallback(async (params: {
    waitId: string
    claimId: string
  }) => {
    chat.clearError()
    await chat.sendMessage({
      text: '',
      metadata: {
        custom: {
          workspaceAssistantHidden: true,
        },
      },
    }, {
      body: {
        control: {
          type: 'task_follow_up',
          waitId: params.waitId,
          claimId: params.claimId,
        },
      },
    })
  }, [chat])

  const addToolApprovalResponse = useCallback(async (params: {
    approvalId: string
    approved: boolean
    reason?: string
  }) => {
    chat.clearError()
    const interruption = findPendingWorkspaceAssistantInterruption(chat.messages)
    if (!interruption || interruption.approvalId !== params.approvalId) {
      throw new Error('PROJECT_AGENT_INTERRUPTION_NOT_FOUND')
    }
    await chat.sendMessage({
      text: params.approved ? 'Tool approval accepted.' : 'Tool approval rejected.',
      metadata: {
        custom: {
          workspaceAssistantHidden: true,
        },
      },
    }, {
      body: {
        control: {
          type: 'approval_response',
          interruptionId: interruption.interruptionId,
          approved: params.approved,
          ...(params.reason ? { reason: params.reason } : {}),
        },
      },
    })
  }, [chat])

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
    approvalRespondedIds: collectResolvedInterruptionApprovalIds(chat.messages),
    error: chat.error,
    syncError,
    storageError: assistantThread.error?.message || null,
    storageLoading: assistantThread.isLoading,
    sendMessage,
    sendHiddenMessage,
    submitChoiceResponse,
    submitTaskFollowUp,
    addToolApprovalResponse,
    replaceMessages,
    appendMessages,
  }
}

export function shouldSendWorkspaceAssistantAutomatically(): boolean {
  return false
}
