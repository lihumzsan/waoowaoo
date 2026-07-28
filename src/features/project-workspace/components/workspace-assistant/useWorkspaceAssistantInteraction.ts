'use client'
import type { UseChatHelpers } from '@ai-sdk/react'
import { readUIMessageStream, type UIMessage } from 'ai'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'
import type { ProjectAgentSessionState } from '@/lib/project-agent/session-state'
import {
  buildProjectAssistantTextAttachmentMetadata,
  type ProjectAssistantTextAttachment,
} from '@/lib/project-agent/text-attachments'
import {
  buildProjectAssistantMediaAttachmentMetadata,
  mergeProjectAssistantMessageMetadata,
  type ProjectAssistantMediaAttachment,
} from '@/lib/project-agent/media-attachments'
import { ensureUniqueUIMessages } from '@/lib/project-agent/ui-message-validation'
import {
  canStopWorkspaceAssistantReply,
  createWorkspaceAssistantControlMessageId,
  createWorkspaceAssistantControlVisibleUserMessage,
  isWorkspaceAssistantRunBusyStatus,
  resolveWorkspaceAssistantReplyInFlight,
  type WorkspaceAssistantControlEndpoint,
  type WorkspaceAssistantControlIntent,
  type WorkspaceAssistantRunStatus,
} from './workspace-assistant-runtime-state'
import {
  buildWorkspaceAssistantControlError,
  WorkspaceAssistantControlTransport,
} from './workspace-assistant-control-transport'
export interface WorkspaceAssistantControlRun {
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
  readonly mediaAttachments?: readonly ProjectAssistantMediaAttachment[]
}
interface WorkspaceAssistantInteractionContext {
  readonly locale: string
  readonly projectId: string
  readonly episodeId?: string
  readonly selectedScopeRef?: string | null
  readonly selectedAssetId?: string | null
}
interface UseWorkspaceAssistantInteractionParams {
  readonly chat: UseChatHelpers<UIMessage>
  readonly context: WorkspaceAssistantInteractionContext
  readonly latestMessagesRef: MutableRefObject<UIMessage[]>
  readonly mergeStreamedAssistantMessage: (message: UIMessage) => UIMessage[]
  readonly pendingInterruptionId: string | null
  readonly projectId: string
  readonly refreshSessionState: () => Promise<ProjectAgentSessionState | null>
  readonly serverRunActive: boolean
}
export function useWorkspaceAssistantInteraction({
  chat,
  context,
  latestMessagesRef,
  mergeStreamedAssistantMessage,
  pendingInterruptionId,
  projectId,
  refreshSessionState,
  serverRunActive,
}: UseWorkspaceAssistantInteractionParams) {
  const controlTransport = useMemo(() => new WorkspaceAssistantControlTransport(), [])
  const controlAbortControllerRef = useRef<AbortController | null>(null)
  const replyActivitySequenceRef = useRef(0)
  const [controlError, setControlError] = useState<Error | null>(null)
  const [respondedInterruptionIds, setRespondedInterruptionIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  )
  const [activeControlRun, setActiveControlRun] = useState<WorkspaceAssistantControlRun | null>(null)
  const [controlRequestActive, setControlRequestActive] = useState(false)
  const [replyActivity, setReplyActivity] = useState<WorkspaceAssistantReplyActivity | null>(null)
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
      if (!current || current.sequence !== sequence || current.requestSettled) return current
      return {
        ...current,
        requestSettled: true,
      }
    })
  }, [])
  const clearReplyActivity = useCallback((sequence?: number): void => {
    setReplyActivity((current) => {
      if (!current || (sequence !== undefined && current.sequence !== sequence)) return current
      return null
    })
  }, [])
  useEffect(() => {
    setRespondedInterruptionIds((current) => {
      if (current.size === 0 || (pendingInterruptionId && current.has(pendingInterruptionId))) {
        return current
      }
      return new Set<string>()
    })
  }, [pendingInterruptionId])
  const sendMessage = useCallback(async (input: WorkspaceAssistantSendMessageInput) => {
    chat.clearError()
    setControlError(null)
    const activitySequence = beginReplyActivity()
    const metadata = mergeProjectAssistantMessageMetadata(
      buildProjectAssistantTextAttachmentMetadata(input.attachments ?? []),
      buildProjectAssistantMediaAttachmentMetadata(input.mediaAttachments ?? []),
    )
    try {
      await chat.sendMessage({
        text: input.text.trim(),
        ...(metadata ? { metadata } : {}),
      })
      await refreshSessionState()
      markReplyActivityRequestSettled(activitySequence)
    } catch (error) {
      await refreshSessionState().catch(() => null)
      clearReplyActivity(activitySequence)
      throw error
    }
  }, [
    beginReplyActivity,
    chat,
    clearReplyActivity,
    markReplyActivityRequestSettled,
    refreshSessionState,
  ])

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
      await refreshSessionState()
      markReplyActivityRequestSettled(activitySequence)
    } catch (error) {
      await refreshSessionState().catch(() => null)
      clearReplyActivity(activitySequence)
      throw error
    }
  }, [
    beginReplyActivity,
    chat,
    clearReplyActivity,
    markReplyActivityRequestSettled,
    refreshSessionState,
  ])

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
      const currentMessages = latestMessagesRef.current.length > 0
        ? latestMessagesRef.current
        : chat.messages
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
            context,
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
      if (requestSucceeded) markReplyActivityRequestSettled(activitySequence)
      await refreshSessionState().catch(() => undefined)
    }
  }, [
    beginReplyActivity,
    chat,
    clearReplyActivity,
    context,
    controlTransport,
    latestMessagesRef,
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
    cardId: string
    toolCallId: string
    output: Record<string, unknown>
    visibleUserText?: string
  }) => {
    const interruptionId = params.interruptionId?.trim()
    const toolCallId = params.toolCallId?.trim()
    const cardId = params.cardId?.trim()
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
  }, [sendControlRequest])

  const stopReply = useCallback(async (): Promise<void> => {
    setControlError(null)
    controlAbortControllerRef.current?.abort()
    await chat.stop()
  }, [chat])

  const controlPending = Boolean(
    activeControlRun && isWorkspaceAssistantRunBusyStatus(activeControlRun.status),
  )
  const chatReplyInFlight = chat.status === 'submitted' || chat.status === 'streaming'
  const canStopReply = canStopWorkspaceAssistantReply({
    chatStatus: chat.status,
    controlRequestActive,
  })
  const replyInFlight = resolveWorkspaceAssistantReplyInFlight({
    requestActive: Boolean(replyActivity && !replyActivity.requestSettled),
    chatTransportActive: chatReplyInFlight,
    controlRunActive: controlPending,
    serverRunActive,
  })
  const backgroundFollowUpActive = serverRunActive
    && !chatReplyInFlight
    && !controlRequestActive
    && replyActivity?.requestSettled !== false

  useEffect(() => {
    if (!replyActivity?.requestSettled || replyInFlight) return
    clearReplyActivity(replyActivity.sequence)
  }, [clearReplyActivity, replyActivity, replyInFlight])

  return {
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
  }
}
