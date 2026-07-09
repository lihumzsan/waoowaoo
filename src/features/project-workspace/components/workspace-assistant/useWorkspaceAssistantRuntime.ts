'use client'

import { useChat } from '@ai-sdk/react'
import { AssistantChatTransport, useAISDKRuntime } from '@assistant-ui/react-ai-sdk'
import type { AssistantRuntime } from '@assistant-ui/react'
import {
  DefaultChatTransport,
  readUIMessageStream,
  type ChatStatus,
  type UIMessage,
  type UIMessageChunk,
} from 'ai'
import { useLocale } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api-fetch'
import {
  useProjectAssistantThread,
} from '@/lib/query/hooks'
import type { ProjectAgentRunPartData } from '@/lib/project-agent/types'
import type {
  ProjectAgentSessionActivity,
  ProjectAgentSessionPendingInteraction,
  ProjectAgentSessionState,
} from '@/lib/project-agent/session-state'
import {
  ensureUniqueUIMessages,
} from '@/lib/project-agent/ui-message-validation'
import type { AssistantPermissionMode } from '@/lib/project-agent/permission-mode'
import {
  buildProjectAssistantTextAttachmentMetadata,
  type ProjectAssistantTextAttachment,
} from '@/lib/project-agent/text-attachments'
import type { WorkspaceAssistantActiveFocusRequest } from '../../workspace-assistant-focus'

export type WorkspaceAssistantChoiceType = 'script_intake' | 'script_review' | 'bible_review' | 'style' | 'asset_review' | 'budget_confirmation'
export type WorkspaceAssistantControlEndpoint = 'approval' | 'choice' | 'task-follow-up'
type WorkspaceAssistantRunStatus = ProjectAgentRunPartData['status']

/**
 * 'approve' resumes the run and executes the approved operation, so the UI may
 * show the operation as actively running. 'deny' only delivers the rejection to
 * the agent — nothing executes, and the reply streams like a normal assistant
 * turn without any operation-running affordance.
 */
type WorkspaceAssistantControlIntent = 'approve' | 'deny' | 'choice' | 'task_follow_up'

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

class WorkspaceAssistantControlTransport extends DefaultChatTransport<UIMessage> {
  public toUIMessageChunkStream(stream: ReadableStream<Uint8Array>): ReadableStream<UIMessageChunk> {
    return this.processResponseStream(stream)
  }
}

interface UseWorkspaceAssistantRuntimeParams {
  projectId: string
  episodeId?: string
  selectedScopeRef?: string | null
  selectedPanelId?: string | null
  selectedAssetId?: string | null
  assistantPermissionMode: AssistantPermissionMode
}

interface UseWorkspaceAssistantRuntimeResult {
  runtime: AssistantRuntime
  messages: UIMessage[]
  messageCount: number
  status: ChatStatus
  pending: boolean
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
  pendingRunApproval: WorkspaceAssistantPendingApproval | null
  sendMessage: (input: WorkspaceAssistantSendMessageInput) => Promise<void>
  sendHiddenMessage: (text: string) => Promise<void>
  submitChoiceResponse: (params: {
    runId: string
    interruptionId: string | null
    choiceType: WorkspaceAssistantChoiceType
    toolCallId: string | null
    output: Record<string, unknown>
    visibleUserText?: string
  }) => Promise<void>
  submitTaskFollowUp: (params: {
    runId: string
    waitId: string
    claimId: string
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

type WorkspaceAssistantSessionPollingState = {
  currentRun: Pick<NonNullable<ProjectAgentSessionState['currentRun']>, 'status'> | null
  activeWaits: ReadonlyArray<Pick<ProjectAgentSessionState['activeWaits'][number], 'status'>>
}

export function buildWorkspaceAssistantChatId(params: {
  projectId: string
  episodeId?: string
}): string {
  return `workspace-command:${params.projectId}:${params.episodeId || 'global'}`
}

let workspaceAssistantControlMessageSequence = 0

function createWorkspaceAssistantControlNonce(): string {
  workspaceAssistantControlMessageSequence += 1
  const sequence = workspaceAssistantControlMessageSequence.toString(36)
  const randomId = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${sequence}`
  return `${sequence}-${randomId}`
}

export function createWorkspaceAssistantControlMessageId(params: {
  runId: string
  endpoint: WorkspaceAssistantControlEndpoint
  nonce?: string
}): string {
  const runId = params.runId.trim()
  if (!runId) throw new Error('PROJECT_ASSISTANT_CONTROL_RUN_ID_MISSING')
  const nonce = params.nonce?.trim() || createWorkspaceAssistantControlNonce()
  return `workspace-control:${params.endpoint}:${runId}:${nonce}`
}

export function createWorkspaceAssistantControlVisibleUserMessage(params: {
  runId: string
  endpoint: WorkspaceAssistantControlEndpoint
  text: string
  nonce?: string
}): UIMessage {
  const runId = params.runId.trim()
  if (!runId) throw new Error('PROJECT_ASSISTANT_CONTROL_RUN_ID_MISSING')
  const text = params.text.trim()
  if (!text) throw new Error('PROJECT_ASSISTANT_CONTROL_VISIBLE_USER_TEXT_EMPTY')
  const nonce = params.nonce?.trim() || createWorkspaceAssistantControlNonce()
  return {
    id: `workspace-control-user:${params.endpoint}:${runId}:${nonce}`,
    role: 'user',
    parts: [{ type: 'text', text }],
  }
}

export function mergeWorkspaceAssistantStreamedMessage(
  currentMessages: readonly UIMessage[],
  message: UIMessage,
): UIMessage[] {
  const messageId = message.id.trim()
  if (!messageId) throw new Error('PROJECT_ASSISTANT_STREAM_MESSAGE_ID_EMPTY')
  const normalizedMessage = messageId === message.id
    ? message
    : {
      ...message,
      id: messageId,
    }
  const existingIndex = currentMessages.findIndex((item) => item.id === messageId)
  const nextMessages = existingIndex >= 0
    ? [
      ...currentMessages.slice(0, existingIndex),
      normalizedMessage,
      ...currentMessages.slice(existingIndex + 1),
    ]
    : [...currentMessages, normalizedMessage]
  return ensureUniqueUIMessages(nextMessages)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function buildWorkspaceAssistantControlError(endpoint: WorkspaceAssistantControlEndpoint, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  const code = endpoint === 'task-follow-up'
    ? 'PROJECT_ASSISTANT_BACKGROUND_FOLLOW_UP_FAILED'
    : 'PROJECT_ASSISTANT_CARD_RESPONSE_FAILED'
  return new Error(`${code}:${message}`)
}

export function isWorkspaceAssistantRunBusyStatus(status: WorkspaceAssistantRunStatus): boolean {
  return status === 'running'
}

export function resolveWorkspaceAssistantReplyInFlight(input: {
  requestActive: boolean
  chatTransportActive: boolean
  controlRunActive: boolean
  serverRunActive: boolean
}): boolean {
  return input.requestActive
    || input.controlRunActive
    || input.serverRunActive
    || input.chatTransportActive
}

export function isWorkspaceAssistantOperationPendingStatus(status: WorkspaceAssistantRunStatus): boolean {
  return status === 'running' || status === 'awaiting_task'
}

function isWorkspaceAssistantActivityPending(activity: ProjectAgentSessionActivity | null): activity is ProjectAgentSessionActivity {
  return !!activity && (activity.status === 'running' || activity.status === 'waiting')
}

function resolveOperationIdFromActivity(activity: ProjectAgentSessionActivity | null): string | null {
  if (!isWorkspaceAssistantActivityPending(activity)) return null
  if (activity.type === 'task_follow_up' || activity.type === 'awaiting_choice') return null
  return activity.operationId ?? activity.sourceOperationId
}

/**
 * The operation-running affordance is only meaningful when the tracked control
 * action actually executes the operation. Denying an approval merely delivers
 * the rejection to the agent, so no operation is pending.
 */
export function resolveWorkspaceAssistantPendingOperationId(
  trackedRun: (Pick<WorkspaceAssistantTrackedRun, 'operationId' | 'intent'> & Partial<Pick<WorkspaceAssistantTrackedRun, 'status'>>) | null,
): string | null {
  if (!trackedRun || trackedRun.intent === 'deny') return null
  if (trackedRun.status && !isWorkspaceAssistantOperationPendingStatus(trackedRun.status)) return null
  return trackedRun.operationId
}

export function resolveWorkspaceAssistantActiveFocusRequest(input: {
  readonly pendingRun: { readonly runId: string } | null
  readonly operationId: string | null
  readonly activities: readonly (ProjectAgentSessionActivity | null)[]
}): WorkspaceAssistantActiveFocusRequest | null {
  if (!input.pendingRun || !input.operationId) return null
  const activity = input.activities.find((candidate) => (
    candidate?.runId === input.pendingRun?.runId
    && resolveOperationIdFromActivity(candidate) === input.operationId
  ))
  return {
    operationId: input.operationId,
    requestKey: activity
      ? `${activity.runId}:${activity.activityId}:${input.operationId}`
      : `${input.pendingRun.runId}:${input.operationId}`,
  }
}

/**
 * The user's response is the authoritative dismissal edge for interaction
 * cards: once a control request is dispatched for an interruption, the card
 * must disappear immediately instead of waiting for session-state polling to
 * observe the server-side consumption. The server stays authoritative for
 * conflicts — a failed control request removes the id again so the card
 * reappears together with the surfaced error.
 */
export function resolveWorkspaceAssistantDisplayedPendingInteraction(input: {
  pendingInteraction: ProjectAgentSessionPendingInteraction | null
  respondedInterruptionIds: ReadonlySet<string>
}): ProjectAgentSessionPendingInteraction | null {
  if (!input.pendingInteraction) return null
  if (input.respondedInterruptionIds.has(input.pendingInteraction.interruptionId)) return null
  return input.pendingInteraction
}

export function shouldPollWorkspaceAssistantSessionState(input: {
  chatStatus: ChatStatus
  controlPending: boolean
  sessionState: WorkspaceAssistantSessionPollingState | null
}): boolean {
  if (input.chatStatus === 'submitted' || input.chatStatus === 'streaming') return true
  if (input.controlPending) return true
  const runStatus = input.sessionState?.currentRun?.status ?? null
  if (runStatus === 'running') return true
  return Boolean(input.sessionState?.activeWaits.some((wait) => (
    wait.status === 'pending'
    || wait.status === 'resolved'
    || wait.status === 'claimed'
  )))
}

export function shouldClearWorkspaceAssistantControlPending(status: WorkspaceAssistantRunStatus): boolean {
  return !isWorkspaceAssistantOperationPendingStatus(status)
}

async function fetchWorkspaceAssistantSessionState(params: {
  projectId: string
  episodeId?: string | null
  locale: string
}): Promise<ProjectAgentSessionState> {
  const query = new URLSearchParams()
  if (params.episodeId) query.set('episodeId', params.episodeId)
  query.set('locale', params.locale)
  const response = await apiFetch(
    `/api/projects/${params.projectId}/assistant/session-state?${query.toString()}`,
  )
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok || !isRecord(payload)) {
    throw new Error('PROJECT_AGENT_SESSION_STATE_FETCH_FAILED')
  }
  if (!isRecord(payload.sessionState)) throw new Error('PROJECT_AGENT_SESSION_STATE_INVALID')
  return payload.sessionState as unknown as ProjectAgentSessionState
}

export function useWorkspaceAssistantRuntime({
  projectId,
  episodeId,
  selectedScopeRef,
  selectedPanelId,
  selectedAssetId,
  assistantPermissionMode,
}: UseWorkspaceAssistantRuntimeParams): UseWorkspaceAssistantRuntimeResult {
  const locale = useLocale()
  const chatId = buildWorkspaceAssistantChatId({
    projectId,
    episodeId,
  })
  const assistantThread = useProjectAssistantThread(projectId, episodeId)
  const contextPayload = useMemo(() => ({
    locale,
    projectId,
    episodeId,
    selectedScopeRef,
    selectedPanelId,
    selectedAssetId,
  }), [episodeId, locale, projectId, selectedAssetId, selectedPanelId, selectedScopeRef])
  const transport = useMemo(() => new AssistantChatTransport({
    api: `/api/projects/${projectId}/assistant/chat`,
    body: {
      context: contextPayload,
      assistantPermissionMode,
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
  }), [assistantPermissionMode, contextPayload, projectId])
  const chat = useChat({
    id: chatId,
    transport,
    sendAutomaticallyWhen: shouldSendWorkspaceAssistantAutomatically,
  })
  const runtime = useAISDKRuntime(chat)
  const controlTransport = useMemo(() => new WorkspaceAssistantControlTransport(), [])
  const hydratedSessionKeyRef = useRef<string | null>(null)
  const latestMessagesRef = useRef<UIMessage[]>(chat.messages)
  const sessionStateRequestRef = useRef<{
    key: string
    promise: Promise<ProjectAgentSessionState | null>
  } | null>(null)
  const refreshSessionStateRef = useRef<(() => Promise<ProjectAgentSessionState | null>) | null>(null)
  const replyActivitySequenceRef = useRef(0)
  const [sessionStateError, setSessionStateError] = useState<string | null>(null)
  const [controlError, setControlError] = useState<Error | null>(null)
  const [respondedInterruptionIds, setRespondedInterruptionIds] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [activeControlRun, setActiveControlRun] = useState<WorkspaceAssistantTrackedRun | null>(null)
  const [replyActivity, setReplyActivity] = useState<WorkspaceAssistantReplyActivity | null>(null)
  const [sessionState, setSessionState] = useState<ProjectAgentSessionState | null>(null)

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

  const applySessionState = useCallback((nextState: ProjectAgentSessionState) => {
    setSessionState(nextState)
    const currentRun = nextState.currentRun
    if (!currentRun) {
      setActiveControlRun(null)
      return
    }
    if (isWorkspaceAssistantOperationPendingStatus(currentRun.status)) {
      const operationId = resolveOperationIdFromActivity(nextState.currentActivity)
      setActiveControlRun((current) => ({
        runId: currentRun.runId,
        status: currentRun.status,
        operationId: operationId ?? (current?.runId === currentRun.runId ? current.operationId : null),
        intent: current?.runId === currentRun.runId ? current.intent : null,
      }))
      return
    }
    if (shouldClearWorkspaceAssistantControlPending(currentRun.status)) {
      setActiveControlRun((current) => {
        return current?.runId === currentRun.runId ? null : current
      })
      return
    }
  }, [])

  const refreshSessionState = useCallback(async (): Promise<ProjectAgentSessionState | null> => {
    const requestKey = `${projectId}:${episodeId ?? ''}:${locale}`
    if (sessionStateRequestRef.current?.key === requestKey) {
      return sessionStateRequestRef.current.promise
    }
    const promise = (async (): Promise<ProjectAgentSessionState | null> => {
      const nextState = await fetchWorkspaceAssistantSessionState({ projectId, episodeId, locale })
      applySessionState(nextState)
      setSessionStateError(null)
      return nextState
    })()
      .catch((error: unknown) => {
        setSessionStateError(error instanceof Error ? error.message : String(error))
        return null
      })
      .finally(() => {
        if (sessionStateRequestRef.current?.promise === promise) {
          sessionStateRequestRef.current = null
        }
      })
    sessionStateRequestRef.current = {
      key: requestKey,
      promise,
    }
    return promise
  }, [applySessionState, episodeId, locale, projectId])
  refreshSessionStateRef.current = refreshSessionState

  const sessionStatePollingControlPending = Boolean(
    activeControlRun && isWorkspaceAssistantRunBusyStatus(activeControlRun.status),
  )
  const shouldPollSessionState = shouldPollWorkspaceAssistantSessionState({
    chatStatus: chat.status,
    controlPending: sessionStatePollingControlPending,
    sessionState,
  })

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
    // reopened interruption (failed run) render its card again.
    const respondedInterruptionId = params.interruptionId?.trim() || null
    if (respondedInterruptionId) markInterruptionResponded(respondedInterruptionId)
    setActiveControlRun({
      runId: params.runId,
      status: 'running',
      operationId: params.operationId ?? null,
      intent: params.intent,
    })
    let requestSucceeded = false
    try {
      const currentMessages = latestMessagesRef.current.length > 0 ? latestMessagesRef.current : chat.messages
      const visibleUserText = params.visibleUserText?.trim() ?? ''
      const displayMessages = visibleUserText
        ? ensureUniqueUIMessages([
            ...currentMessages,
            createWorkspaceAssistantControlVisibleUserMessage({
              runId: params.runId,
              endpoint: params.endpoint,
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
          body: JSON.stringify({
            context: contextPayload,
            assistantPermissionMode,
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
      setControlError(buildWorkspaceAssistantControlError(params.endpoint, error))
      clearReplyActivity(activitySequence)
      throw error
    } finally {
      await refreshSessionState().catch(() => undefined)
      if (requestSucceeded) {
        markReplyActivityRequestSettled(activitySequence)
        if (respondedInterruptionId) unmarkInterruptionResponded(respondedInterruptionId)
      }
    }
  }, [
    assistantPermissionMode,
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
    interruptionId: string | null
    choiceType: WorkspaceAssistantChoiceType
    toolCallId: string | null
    output: Record<string, unknown>
    visibleUserText?: string
  }) => {
    await sendControlRequest({
      runId: params.runId,
      endpoint: 'choice',
      intent: 'choice',
      interruptionId: params.interruptionId,
      visibleUserText: params.visibleUserText,
      payload: {
        interruptionId: params.interruptionId,
        choiceType: params.choiceType,
        toolCallId: params.toolCallId,
        output: params.output,
      },
    })
  }, [sendControlRequest])

  const submitTaskFollowUp = useCallback(async (params: {
    runId: string
    waitId: string
    claimId: string
  }) => {
    await sendControlRequest({
      runId: params.runId,
      endpoint: 'task-follow-up',
      intent: 'task_follow_up',
      operationId: null,
      payload: {
        waitId: params.waitId,
        claimId: params.claimId,
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
  }, [assistantThread.data, assistantThread.isLoading, chat.messages, chatId, replaceMessages])

  useEffect(() => {
    void refreshSessionState()
  }, [chatId, refreshSessionState])

  useEffect(() => {
    if (!shouldPollSessionState) return
    let cancelled = false
    let timer: number | null = null

    void refreshSessionState().catch(() => undefined)

    const poll = () => {
      timer = window.setTimeout(() => {
        void refreshSessionState()
          .catch(() => undefined)
          .finally(() => {
            if (cancelled) return
            poll()
          })
      }, 1500)
    }

    poll()
    return () => {
      cancelled = true
      if (timer !== null) {
        window.clearTimeout(timer)
      }
    }
  }, [refreshSessionState, shouldPollSessionState])

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
  const pendingRun = activeControlRun ?? serverOperationRun
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
  const serverRunActive = sessionState?.currentRun?.status === 'running'
  const replyInFlight = resolveWorkspaceAssistantReplyInFlight({
    requestActive: Boolean(replyActivity && !replyActivity.requestSettled),
    chatTransportActive: chatReplyInFlight,
    controlRunActive: controlPending,
    serverRunActive,
  })

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
    pendingRunApproval,
    sendMessage,
    sendHiddenMessage,
    submitChoiceResponse,
    submitTaskFollowUp,
    addRunApprovalResponse,
    replaceMessages,
    appendMessages,
  }
}

export function shouldSendWorkspaceAssistantAutomatically(): boolean {
  return false
}
