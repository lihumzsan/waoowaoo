'use client'

import { useChat } from '@ai-sdk/react'
import { AssistantChatTransport, useAISDKRuntime } from '@assistant-ui/react-ai-sdk'
import type { AssistantRuntime } from '@assistant-ui/react'
import {
  readUIMessageStream,
  type ChatStatus,
  type UIMessage,
} from 'ai'
import { useLocale } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  useProjectAssistantThread,
} from '@/lib/query/hooks'
import type {
  ProjectAgentSessionPendingInteraction,
  ProjectAgentSessionState,
} from '@/lib/project-agent/session-state'
import { ensureUniqueUIMessages } from '@/lib/project-agent/ui-message-validation'
import {
  buildProjectAssistantTextAttachmentMetadata,
  type ProjectAssistantTextAttachment,
} from '@/lib/project-agent/text-attachments'
import type { WorkspaceAssistantActiveFocusRequest } from '../../workspace-assistant-focus'
import {
  useWorkspaceAssistantThreadSnapshotSync,
} from './useWorkspaceAssistantThreadSnapshotSync'
import { useWorkspaceAssistantSessionSync } from './useWorkspaceAssistantSessionSync'
import {
  buildWorkspaceAssistantChatId,
  canStopWorkspaceAssistantReply,
  createWorkspaceAssistantControlMessageId,
  createWorkspaceAssistantControlVisibleUserMessage,
  isWorkspaceAssistantRunBusyStatus,
  isWorkspaceAssistantOperationPendingStatus,
  mergeWorkspaceAssistantStreamedMessage,
  resolveWorkspaceAssistantActiveFocusRequest,
  resolveWorkspaceAssistantDisplayedPendingInteraction,
  resolveWorkspaceAssistantPendingOperationId,
  resolveWorkspaceAssistantReplyInFlight,
  resolveOperationIdFromActivity,
  shouldSendWorkspaceAssistantAutomatically,
  type WorkspaceAssistantControlEndpoint,
  type WorkspaceAssistantControlIntent,
  type WorkspaceAssistantRunStatus,
} from './workspace-assistant-runtime-state'
import type { ProjectAgentSubagentView } from '@/lib/project-agent/subagent-events'
import { resolveWorkspaceAssistantActiveSubagents } from './workspace-assistant-subagents'
import {
  buildWorkspaceAssistantControlError,
  WorkspaceAssistantControlTransport,
} from './workspace-assistant-control-transport'

/**
 * 'approve' resumes the run and executes the approved operation, so the UI may
 * show the operation as actively running. 'deny' only delivers the rejection to
 * the agent — nothing executes, and the reply streams like a normal assistant
 * turn without any operation-running affordance.
 */
interface WorkspaceAssistantTrackedRun {
  runId: string
  status: WorkspaceAssistantRunStatus
  operationId: string | null
  intent: WorkspaceAssistantControlIntent | null
}

interface WorkspaceAssistantReplyActivity {
  sequence: number
  requestSettled: boolean
}

export interface WorkspaceAssistantSendMessageInput {
  readonly text: string
  readonly attachments?: readonly ProjectAssistantTextAttachment[]
}

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
  status: ChatStatus
  pending: boolean
  canStopReply: boolean
  replyInFlight: boolean
  controlPending: boolean
  pendingApprovalId: string | null
  sessionState: ProjectAgentSessionState | null
  pendingInteraction: ProjectAgentSessionPendingInteraction | null
  error: Error | undefined
  sessionStateError: string | null
  storageError: string | null
  storageLoading: boolean
  pendingOperationId: string | null
  activeFocusRequest: WorkspaceAssistantActiveFocusRequest | null
  activeSubagents: ProjectAgentSubagentView[]
  pendingRunApproval: WorkspaceAssistantPendingApproval | null
  sendMessage: (input: WorkspaceAssistantSendMessageInput) => Promise<void>
  sendHiddenMessage: (text: string) => Promise<void>
  stopReply: () => Promise<void>
  submitChoiceResponse: (params: {
    runId: string
    interruptionId: string
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
  const controlTransport = useMemo(() => new WorkspaceAssistantControlTransport(), [])
  const latestMessagesRef = useRef<UIMessage[]>(chat.messages)
  const refreshSessionStateRef = useRef<(() => Promise<ProjectAgentSessionState | null>) | null>(null)
  const controlAbortControllerRef = useRef<AbortController | null>(null)
  const replyActivitySequenceRef = useRef(0)
  const [controlError, setControlError] = useState<Error | null>(null)
  const [respondedInterruptionIds, setRespondedInterruptionIds] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [activeControlRun, setActiveControlRun] = useState<WorkspaceAssistantTrackedRun | null>(null)
  const [controlRequestActive, setControlRequestActive] = useState(false)
  const [replyActivity, setReplyActivity] = useState<WorkspaceAssistantReplyActivity | null>(null)
  const {
    sessionState,
    sessionStateError,
    sessionEventWatermark,
    refreshSessionState,
  } = useWorkspaceAssistantSessionSync({
    projectId,
    episodeId,
    locale,
  })
  const assistantThread = useProjectAssistantThread(projectId, episodeId, sessionEventWatermark)

  useEffect(() => {
    latestMessagesRef.current = chat.messages
  }, [chat.messages])

  const markInterruptionResponded = useCallback((interruptionId: string): void => {
    setRespondedInterruptionIds((current) => {
      if (current.has(interruptionId)) return current
      const next = new Set(current)
      next.add(interruptionId)
      return next
    })
  }, [])

  const unmarkInterruptionResponded = useCallback((interruptionId: string): void => {
    setRespondedInterruptionIds((current) => {
      if (!current.has(interruptionId)) return current
      const next = new Set(current)
      next.delete(interruptionId)
      return next
    })
  }, [])

  const beginReplyActivity = useCallback((): number => {
    replyActivitySequenceRef.current += 1
    const sequence = replyActivitySequenceRef.current
    setReplyActivity({
      sequence,
      requestSettled: false,
    })
    return sequence
  }, [])

  const markReplyActivityRequestSettled = useCallback((sequence: number): void => {
    setReplyActivity((current) => {
      if (!current || current.sequence !== sequence) return current
      if (current.requestSettled) return current
      return {
        ...current,
        requestSettled: true,
      }
    })
  }, [])

  const clearReplyActivity = useCallback((sequence?: number): void => {
    setReplyActivity((current) => {
      if (!current) return current
      if (sequence !== undefined && current.sequence !== sequence) return current
      return null
    })
  }, [])

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

  // The user's new message supersedes any pending approval server-side; the
  // stream answers with an interruption-resolved part so the card closes.
  const sendMessage = useCallback(async (input: WorkspaceAssistantSendMessageInput) => {
    chat.clearError()
    setControlError(null)
    const activitySequence = beginReplyActivity()
    const attachments = input.attachments ?? []
    const text = input.text.trim()
    const metadata = buildProjectAssistantTextAttachmentMetadata(attachments)
    try {
      await chat.sendMessage({
        text,
        ...(metadata ? { metadata } : {}),
      })
      await refreshSessionStateRef.current?.()
      markReplyActivityRequestSettled(activitySequence)
    } catch (error) {
      await refreshSessionStateRef.current?.().catch(() => null)
      clearReplyActivity(activitySequence)
      throw error
    }
  }, [beginReplyActivity, chat, clearReplyActivity, markReplyActivityRequestSettled])

  const sendHiddenMessage = useCallback(async (text: string) => {
    chat.clearError()
    setControlError(null)
    const activitySequence = beginReplyActivity()
    try {
      await chat.sendMessage({
        text,
        metadata: {
          custom: {
            workspaceAssistantHidden: true,
          },
        },
      })
      await refreshSessionStateRef.current?.()
      markReplyActivityRequestSettled(activitySequence)
    } catch (error) {
      await refreshSessionStateRef.current?.().catch(() => null)
      clearReplyActivity(activitySequence)
      throw error
    }
  }, [beginReplyActivity, chat, clearReplyActivity, markReplyActivityRequestSettled])

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

  refreshSessionStateRef.current = refreshSessionState

  useEffect(() => {
    const pendingInterruptionId = sessionState?.pendingInteraction?.interruptionId ?? null
    setRespondedInterruptionIds((current) => {
      if (current.size === 0 || (pendingInterruptionId && current.has(pendingInterruptionId))) return current
      return new Set<string>()
    })
  }, [sessionState?.pendingInteraction?.interruptionId])

  const sendControlRequest = useCallback(async (params: {
    runId: string
    endpoint: WorkspaceAssistantControlEndpoint
    intent: WorkspaceAssistantControlIntent
    interruptionId?: string | null
    operationId?: string | null
    payload: Record<string, unknown>
    visibleUserText?: string
  }) => {
    chat.clearError()
    setControlError(null)
    const activitySequence = beginReplyActivity()
    const controlMessageId = createWorkspaceAssistantControlMessageId({
      runId: params.runId,
      endpoint: params.endpoint,
    })
    // Suppress the answered interaction card in the same render as the click.
    // The mark stays until the post-run session refresh so stale polls cannot
    // revive the card; unmarking after that refresh lets a server-side
    // authoritative server response that still reports pending render its card again.
    const respondedInterruptionId = params.interruptionId?.trim() || null
    if (respondedInterruptionId) markInterruptionResponded(respondedInterruptionId)
    setActiveControlRun({
      runId: params.runId,
      status: 'running',
      operationId: params.operationId ?? null,
      intent: params.intent,
    })
    const abortController = new AbortController()
    controlAbortControllerRef.current = abortController
    setControlRequestActive(true)
    let requestSucceeded = false
    try {
      const currentMessages = latestMessagesRef.current.length > 0 ? latestMessagesRef.current : chat.messages
      const visibleUserText = params.visibleUserText?.trim() ?? ''
      if (visibleUserText && !respondedInterruptionId) {
        throw new Error('PROJECT_AGENT_CONTROL_VISIBLE_USER_MESSAGE_IDENTITY_REQUIRED')
      }
      const displayMessages = visibleUserText && respondedInterruptionId
        ? ensureUniqueUIMessages([
            ...currentMessages,
            createWorkspaceAssistantControlVisibleUserMessage({
              runId: params.runId,
              endpoint: params.endpoint,
              interruptionId: respondedInterruptionId,
              text: visibleUserText,
            }),
          ])
        : currentMessages
      if (visibleUserText) {
        latestMessagesRef.current = displayMessages
        chat.setMessages(displayMessages)
      }
      const response = await fetch(
        `/api/projects/${projectId}/assistant/runs/${encodeURIComponent(params.runId)}/${params.endpoint}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: abortController.signal,
          body: JSON.stringify({
            context: contextPayload,
            ...(visibleUserText ? { visibleUserText } : {}),
            ...params.payload,
          }),
        },
      )
      if (!response.ok || !response.body) {
        const errorText = await response.text().catch(() => '')
        throw new Error(errorText || `PROJECT_AGENT_CONTROL_REQUEST_FAILED:${String(response.status)}`)
      }
      const chunkStream = controlTransport.toUIMessageChunkStream(response.body)
      for await (const message of readUIMessageStream({
        stream: chunkStream,
        terminateOnError: true,
        message: {
          id: controlMessageId,
          role: 'assistant',
          parts: [],
        },
      })) {
        mergeStreamedAssistantMessage(message)
      }
      requestSucceeded = true
    } catch (error) {
      if (respondedInterruptionId) unmarkInterruptionResponded(respondedInterruptionId)
      setActiveControlRun((current) => current?.runId === params.runId ? null : current)
      if (abortController.signal.aborted) {
        clearReplyActivity(activitySequence)
        return
      }
      setControlError(buildWorkspaceAssistantControlError(params.endpoint, error))
      clearReplyActivity(activitySequence)
      throw error
    } finally {
      if (controlAbortControllerRef.current === abortController) {
        controlAbortControllerRef.current = null
        setControlRequestActive(false)
      }
      setActiveControlRun((current) => current?.runId === params.runId ? null : current)
      if (requestSucceeded) {
        markReplyActivityRequestSettled(activitySequence)
      }
      await refreshSessionState().catch(() => undefined)
    }
  }, [
    beginReplyActivity,
    chat,
    clearReplyActivity,
    contextPayload,
    controlTransport,
    markInterruptionResponded,
    markReplyActivityRequestSettled,
    mergeStreamedAssistantMessage,
    projectId,
    refreshSessionState,
    unmarkInterruptionResponded,
  ])

  const submitChoiceResponse = useCallback(async (params: {
    runId: string
    interruptionId: string
    toolCallId: string
    output: Record<string, unknown>
    visibleUserText?: string
  }) => {
    const interruptionId = params.interruptionId?.trim()
    const toolCallId = params.toolCallId?.trim()
    const cardId = typeof params.output.cardId === 'string' ? params.output.cardId.trim() : ''
    if (!interruptionId || !toolCallId || !cardId) {
      throw new Error('PROJECT_AGENT_CHOICE_OFFER_IDENTITY_REQUIRED')
    }
    await sendControlRequest({
      runId: params.runId,
      endpoint: 'choice',
      intent: 'choice',
      interruptionId,
      visibleUserText: params.visibleUserText,
      payload: {
        interruptionId,
        cardId,
        toolCallId,
        output: params.output,
      },
    })
  }, [sendControlRequest])

  const addRunApprovalResponse = useCallback(async (params: {
    runId: string
    interruptionId: string
    approvalId: string
    operationId: string
    approved: boolean
    reason?: string
  }) => {
    chat.clearError()
    await sendControlRequest({
      runId: params.runId,
      endpoint: 'approval',
      intent: params.approved ? 'approve' : 'deny',
      interruptionId: params.interruptionId,
      operationId: params.operationId,
      visibleUserText: params.approved ? undefined : params.reason,
      payload: {
        interruptionId: params.interruptionId,
        approved: params.approved,
        ...(params.reason ? { reason: params.reason } : {}),
      },
    })
  }, [chat, sendControlRequest])

  const stopReply = useCallback(async (): Promise<void> => {
    setControlError(null)
    controlAbortControllerRef.current?.abort()
    await chat.stop()
  }, [chat])

  useEffect(() => {
    if (assistantThread.isLoading || !assistantThread.data) return
    syncPersistedThreadMessages(assistantThread.data.thread)
  }, [assistantThread.data, assistantThread.isLoading, chatId, syncPersistedThreadMessages])
  const pendingInteraction = resolveWorkspaceAssistantDisplayedPendingInteraction({
    pendingInteraction: sessionState?.pendingInteraction ?? null,
    respondedInterruptionIds,
  })
  const pendingRunApproval = pendingInteraction?.kind === 'approval' ? pendingInteraction : null
  const serverOperationId = resolveOperationIdFromActivity(sessionState?.currentActivity ?? null)
  const serverOperationRun: WorkspaceAssistantTrackedRun | null = sessionState?.currentRun
    && isWorkspaceAssistantOperationPendingStatus(sessionState.currentRun.status)
    && serverOperationId
    ? {
      runId: sessionState.currentRun.runId,
      status: sessionState.currentRun.status,
      operationId: serverOperationId,
      intent: null,
    }
    : null
  const pendingRun = serverOperationRun ?? activeControlRun
  const pendingOperationId = resolveWorkspaceAssistantPendingOperationId(pendingRun)
  const activeFocusRequest = useMemo(() => resolveWorkspaceAssistantActiveFocusRequest({
    pendingRun,
    operationId: pendingOperationId,
    activities: [
      sessionState?.currentActivity ?? null,
    ],
  }), [
    pendingOperationId,
    pendingRun,
    sessionState?.currentActivity,
  ])
  const controlPending = Boolean(activeControlRun && isWorkspaceAssistantRunBusyStatus(activeControlRun.status))
  const chatReplyInFlight = chat.status === 'submitted' || chat.status === 'streaming'
  const canStopReply = canStopWorkspaceAssistantReply({
    chatStatus: chat.status,
    controlRequestActive,
  })
  const serverRunActive = sessionState?.currentRun?.status === 'running'
  const replyInFlight = resolveWorkspaceAssistantReplyInFlight({
    requestActive: Boolean(replyActivity && !replyActivity.requestSettled),
    chatTransportActive: chatReplyInFlight,
    controlRunActive: controlPending,
    serverRunActive,
  })
  const activeSubagents = useMemo(() => resolveWorkspaceAssistantActiveSubagents({
    sessionSubagents: sessionState?.activeSubagents ?? [],
    messages: chat.messages,
  }), [chat.messages, sessionState?.activeSubagents])

  useEffect(() => {
    if (!replyActivity || !replyActivity.requestSettled) return
    if (replyInFlight) return
    clearReplyActivity(replyActivity.sequence)
  }, [clearReplyActivity, replyActivity, replyInFlight])

  return {
    runtime,
    messages: chat.messages,
    messageCount: chat.messages.length,
    status: chat.status,
    pending: Boolean(pendingRun) || replyInFlight,
    canStopReply,
    replyInFlight,
    controlPending,
    pendingApprovalId: pendingRunApproval?.approvalId ?? null,
    sessionState,
    pendingInteraction,
    error: chat.error ?? controlError ?? undefined,
    sessionStateError,
    storageError: assistantThread.error?.message || null,
    storageLoading: assistantThread.isLoading,
    pendingOperationId,
    activeFocusRequest,
    activeSubagents,
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
