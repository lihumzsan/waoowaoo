'use client'

import { useChat } from '@ai-sdk/react'
import { AssistantChatTransport, useAISDKRuntime } from '@assistant-ui/react-ai-sdk'
import type { AssistantRuntime } from '@assistant-ui/react'
import type { UIMessage } from 'ai'
import { useLocale } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useProjectAssistantThread } from '@/lib/query/hooks'
import type {
  ProjectAgentSessionPendingInteraction,
  ProjectAgentSessionState,
} from '@/lib/project-agent/session-state'
import { ensureUniqueUIMessages } from '@/lib/project-agent/ui-message-validation'
import {
  useWorkspaceAssistantThreadSnapshotSync,
} from './useWorkspaceAssistantThreadSnapshotSync'
import { useWorkspaceAssistantSessionSync } from './useWorkspaceAssistantSessionSync'
import {
  buildWorkspaceAssistantChatId,
  isWorkspaceAssistantOperationPendingStatus,
  mergeWorkspaceAssistantStreamedMessage,
  resolveWorkspaceAssistantComposerPending,
  resolveWorkspaceAssistantDisplayedPendingInteraction,
  resolveOperationIdFromActivity,
  shouldSendWorkspaceAssistantAutomatically,
} from './workspace-assistant-runtime-state'
import type { ProjectAgentSubagentView } from '@/lib/project-agent/subagent-events'
import {
  resolveWorkspaceAssistantSubagents,
  resolveWorkspaceAssistantSubagentStructuredOutputs,
} from './workspace-assistant-subagents'
import {
  useWorkspaceAssistantInteraction,
  type WorkspaceAssistantControlRun,
  type WorkspaceAssistantSendMessageInput,
} from './useWorkspaceAssistantInteraction'

/**
 * 'approve' resumes the run and executes the approved operation, so the UI may
 * show the operation as actively running. 'deny' only delivers the rejection to
 * the agent — nothing executes, and the reply streams like a normal assistant
 * turn without any operation-running affordance.
 */
export type { WorkspaceAssistantSendMessageInput } from './useWorkspaceAssistantInteraction'

type WorkspaceAssistantPendingApproval = Extract<ProjectAgentSessionPendingInteraction, { kind: 'approval' }>

interface UseWorkspaceAssistantRuntimeParams {
  projectId: string
  episodeId?: string
  selectedScopeRef?: string | null
  selectedAssetId?: string | null
}

interface UseWorkspaceAssistantRuntimeResult {
  runtime: AssistantRuntime
  messages: UIMessage[]
  messageCount: number
  pending: boolean
  canStopReply: boolean
  replyInFlight: boolean
  backgroundFollowUpActive: boolean
  controlPending: boolean
  pendingApprovalId: string | null
  sessionState: ProjectAgentSessionState | null
  pendingInteraction: ProjectAgentSessionPendingInteraction | null
  error: Error | undefined
  sessionStateError: string | null
  storageError: string | null
  storageLoading: boolean
  subagents: ProjectAgentSubagentView[]
  subagentStructuredOutputs: ReadonlyMap<string, string>
  pendingRunApproval: WorkspaceAssistantPendingApproval | null
  sendMessage: (input: WorkspaceAssistantSendMessageInput) => Promise<void>
  sendHiddenMessage: (text: string) => Promise<void>
  stopReply: () => Promise<void>
  submitChoiceResponse: (params: {
    runId: string
    interruptionId: string
    cardId: string
    toolCallId: string
    output: Record<string, unknown>
    visibleUserText?: string
  }) => Promise<void>
  addRunApprovalResponse: (params: {
    runId: string
    interruptionId: string
    approvalId: string
    operationId: string
    approved: boolean
    reason?: string
  }) => Promise<void>
  replaceMessages: (messages: UIMessage[]) => void
  appendMessages: (messages: UIMessage[]) => void
}

export function useWorkspaceAssistantRuntime({
  projectId,
  episodeId,
  selectedScopeRef,
  selectedAssetId,
}: UseWorkspaceAssistantRuntimeParams): UseWorkspaceAssistantRuntimeResult {
  const locale = useLocale()
  const chatId = buildWorkspaceAssistantChatId({ projectId, episodeId })
  const contextPayload = useMemo(() => ({
    locale,
    projectId,
    episodeId,
    selectedScopeRef,
    selectedAssetId,
  }), [episodeId, locale, projectId, selectedAssetId, selectedScopeRef])
  const transport = useMemo(() => new AssistantChatTransport({
    api: `/api/projects/${projectId}/assistant/chat`,
    body: {
      context: contextPayload,
    },
    prepareSendMessagesRequest: async (options) => {
      const message = options.messages.find((item) => item.id === options.messageId)
        ?? options.messages[options.messages.length - 1]
      if (!message) throw new Error('PROJECT_ASSISTANT_MESSAGE_MISSING')
      return {
        body: {
          ...options.body,
          id: options.id,
          message,
          trigger: options.trigger,
          messageId: options.messageId,
          metadata: options.requestMetadata,
        },
      }
    },
  }), [contextPayload, projectId])
  const chat = useChat({
    id: chatId,
    transport,
    sendAutomaticallyWhen: shouldSendWorkspaceAssistantAutomatically,
  })
  const runtime = useAISDKRuntime(chat)
  const latestMessagesRef = useRef<UIMessage[]>(chat.messages)
  const {
    sessionState,
    sessionStateError,
    sessionEventWatermark,
    refreshSessionState,
    subagentLiveStreams,
  } = useWorkspaceAssistantSessionSync({
    projectId,
    episodeId,
    locale,
  })
  const assistantThread = useProjectAssistantThread(projectId, episodeId, sessionEventWatermark)

  useEffect(() => {
    latestMessagesRef.current = chat.messages
  }, [chat.messages])

  const replaceMessages = useCallback((messages: UIMessage[]) => {
    const nextMessages = ensureUniqueUIMessages(messages)
    latestMessagesRef.current = nextMessages
    chat.setMessages(nextMessages)
  }, [chat])

  const syncPersistedThreadMessages = useWorkspaceAssistantThreadSnapshotSync({
    chatId,
    latestMessagesRef,
    setMessages: chat.setMessages,
  })

  const appendMessages = useCallback((messages: UIMessage[]) => {
    if (messages.length === 0) return
    chat.setMessages((current) => {
      const nextMessages = ensureUniqueUIMessages([...current, ...messages])
      latestMessagesRef.current = nextMessages
      return nextMessages
    })
  }, [chat])

  const mergeStreamedAssistantMessage = useCallback((message: UIMessage): UIMessage[] => {
    const nextMessages = mergeWorkspaceAssistantStreamedMessage(latestMessagesRef.current, message)
    latestMessagesRef.current = nextMessages
    chat.setMessages(nextMessages)
    return nextMessages
  }, [chat])

  useEffect(() => {
    if (assistantThread.isLoading || !assistantThread.data) return
    syncPersistedThreadMessages(assistantThread.data.thread)
  }, [assistantThread.data, assistantThread.isLoading, chatId, syncPersistedThreadMessages])
  const serverOperationId = resolveOperationIdFromActivity(sessionState?.currentActivity ?? null)
  const serverOperationRun: WorkspaceAssistantControlRun | null = sessionState?.currentRun
    && isWorkspaceAssistantOperationPendingStatus(sessionState.currentRun.status)
    && serverOperationId
    ? {
      runId: sessionState.currentRun.runId,
      status: sessionState.currentRun.status,
      operationId: serverOperationId,
      intent: null,
    }
    : null
  const serverRunActive = sessionState?.currentRun?.status === 'running'
  const {
    activeControlRun,
    addRunApprovalResponse,
    backgroundFollowUpActive,
    canStopReply,
    controlError,
    controlPending,
    replyInFlight,
    respondedInterruptionIds,
    sendHiddenMessage,
    sendMessage,
    stopReply,
    submitChoiceResponse,
  } = useWorkspaceAssistantInteraction({
    chat,
    context: contextPayload,
    latestMessagesRef,
    mergeStreamedAssistantMessage,
    pendingInterruptionId: sessionState?.pendingInteraction?.interruptionId ?? null,
    projectId,
    refreshSessionState,
    serverRunActive,
  })
  const pendingInteraction = resolveWorkspaceAssistantDisplayedPendingInteraction({
    pendingInteraction: sessionState?.pendingInteraction ?? null,
    respondedInterruptionIds,
  })
  const pendingRunApproval = pendingInteraction?.kind === 'approval' ? pendingInteraction : null
  const pendingRun = serverOperationRun ?? activeControlRun
  const composerPending = resolveWorkspaceAssistantComposerPending({
    replyInFlight,
    trackedRunStatus: pendingRun?.status ?? null,
  })
  const subagents = useMemo(() => resolveWorkspaceAssistantSubagents({
    sessionSubagents: sessionState?.subagents ?? [],
    liveStreams: subagentLiveStreams,
  }), [sessionState?.subagents, subagentLiveStreams])
  const subagentStructuredOutputs = useMemo(
    () => resolveWorkspaceAssistantSubagentStructuredOutputs(subagentLiveStreams),
    [subagentLiveStreams],
  )

  return {
    runtime,
    messages: chat.messages,
    messageCount: chat.messages.length,
    pending: composerPending,
    canStopReply,
    replyInFlight,
    backgroundFollowUpActive,
    controlPending,
    pendingApprovalId: pendingRunApproval?.approvalId ?? null,
    sessionState,
    pendingInteraction,
    error: chat.error ?? controlError ?? undefined,
    sessionStateError,
    storageError: assistantThread.error?.message || null,
    storageLoading: assistantThread.isLoading,
    subagents,
    subagentStructuredOutputs,
    pendingRunApproval,
    sendMessage,
    sendHiddenMessage,
    stopReply,
    submitChoiceResponse,
    addRunApprovalResponse,
    replaceMessages,
    appendMessages,
  }
}
