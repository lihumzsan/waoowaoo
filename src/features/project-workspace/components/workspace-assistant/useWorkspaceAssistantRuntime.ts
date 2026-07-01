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
  useProjectAssistantThreadSync,
} from '@/lib/query/hooks'
import type { ProjectAgentRunPartData } from '@/lib/project-agent/types'
import type {
  ProjectAgentSessionActivity,
  ProjectAgentSessionPendingInteraction,
  ProjectAgentSessionState,
} from '@/lib/project-agent/session-state'
import {
  ensureUniqueUIMessages,
  validatePersistableUIMessages,
  type UIMessagesPersistabilityError,
} from '@/lib/project-agent/ui-message-validation'
import type { AssistantPermissionMode } from '@/lib/project-agent/permission-mode'
import type { WorkspaceAssistantActiveFocusRequest } from '../../workspace-assistant-focus'

export type WorkspaceAssistantChoiceType = 'duration_and_aspect_ratio' | 'screenplay_review' | 'style' | 'asset_review'
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
  messageIndex: number
  requestSettled: boolean
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
  approvalRespondedIds: ReadonlySet<string>
  sessionState: ProjectAgentSessionState | null
  pendingInteraction: ProjectAgentSessionPendingInteraction | null
  error: Error | undefined
  syncError: string | null
  sessionStateError: string | null
  storageError: string | null
  storageLoading: boolean
  pendingOperationId: string | null
  activeFocusRequest: WorkspaceAssistantActiveFocusRequest | null
  pendingRunApproval: WorkspaceAssistantPendingApproval | null
  sendMessage: (text: string) => Promise<void>
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
  addToolApprovalResponse: (params: {
    approvalId: string
    approved: boolean
    reason?: string
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

function formatPersistabilityError(error: UIMessagesPersistabilityError): string {
  const messageIndex = error.messageIndex === null ? 'root' : String(error.messageIndex)
  return `PROJECT_ASSISTANT_THREAD_NOT_PERSISTABLE:${error.code}:${messageIndex}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isWorkspaceAssistantRunStatus(value: unknown): value is WorkspaceAssistantRunStatus {
  return value === 'running'
    || value === 'awaiting_approval'
    || value === 'awaiting_choice'
    || value === 'awaiting_task'
    || value === 'completed'
    || value === 'failed'
    || value === 'cancelled'
}

export function isWorkspaceAssistantRunBusyStatus(status: WorkspaceAssistantRunStatus): boolean {
  return status === 'running'
}

export function resolveWorkspaceAssistantReplyInFlight(input: {
  requestActive: boolean
  chatTransportActive: boolean
  controlRunActive: boolean
  serverRunActive: boolean
  streamedRunStatus: WorkspaceAssistantRunStatus | null
}): boolean {
  const streamedRunActive = input.streamedRunStatus === 'running'
  const streamedRunSettledOrYielded = input.streamedRunStatus !== null && !streamedRunActive
  if (streamedRunSettledOrYielded) return false
  return input.requestActive
    || input.controlRunActive
    || input.serverRunActive
    || streamedRunActive
    || input.chatTransportActive
}

export function resolveWorkspaceAssistantActiveReplyRunStatus(input: {
  activeReplyRun: Pick<WorkspaceAssistantTrackedRun, 'runId' | 'status'> | null
  serverRun: Pick<NonNullable<ProjectAgentSessionState['currentRun']>, 'runId' | 'status'> | null
  replyActivityActive: boolean
  chatTransportActive: boolean
  controlRunActive: boolean
}): WorkspaceAssistantRunStatus | null {
  const activeReplyRun = input.activeReplyRun
  if (!activeReplyRun) return null
  if (input.serverRun?.runId === activeReplyRun.runId) return input.serverRun.status
  if (
    input.replyActivityActive
    || input.chatTransportActive
    || input.controlRunActive
  ) return activeReplyRun.status
  return null
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

function readWorkspaceAssistantRunPart(part: unknown): WorkspaceAssistantTrackedRun | null {
  if (!isRecord(part) || part.type !== 'data-agent-run') return null
  const data = isRecord(part.data) ? part.data : null
  const runId = readNonEmptyString(data?.runId)
  if (!runId || !isWorkspaceAssistantRunStatus(data?.status)) return null
  return {
    runId,
    status: data.status,
    operationId: null,
    intent: null,
  }
}

export function findLatestWorkspaceAssistantRun(messages: readonly UIMessage[]): WorkspaceAssistantTrackedRun | null {
  return findLatestWorkspaceAssistantRunAtOrAfterMessageIndex(messages, 0)
}

export function findLatestWorkspaceAssistantRunAtOrAfterMessageIndex(
  messages: readonly UIMessage[],
  messageIndex: number,
): WorkspaceAssistantTrackedRun | null {
  for (let currentIndex = messages.length - 1; currentIndex >= Math.max(0, messageIndex); currentIndex -= 1) {
    const message = messages[currentIndex]
    if (!message || message.role !== 'assistant') continue
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const run = readWorkspaceAssistantRunPart(message.parts[partIndex])
      if (run) return run
    }
  }
  return null
}

function readWorkspaceAssistantActivityPart(part: unknown): ProjectAgentSessionActivity | null {
  if (!isRecord(part) || part.type !== 'data-agent-activity') return null
  const data = isRecord(part.data) ? part.data : null
  if (!data) return null
  const activityId = readNonEmptyString(data.activityId)
  const runId = readNonEmptyString(data.runId)
  if (!activityId || !runId) return null
  const type = data.type
  const status = data.status
  if (
    type !== 'operation'
    && type !== 'waiting_task'
    && type !== 'task_follow_up'
    && type !== 'awaiting_choice'
    && type !== 'awaiting_approval'
  ) return null
  if (
    status !== 'running'
    && status !== 'waiting'
    && status !== 'completed'
    && status !== 'failed'
    && status !== 'cancelled'
  ) return null
  const choiceType = data.choiceType
  if (
    choiceType !== null
    && choiceType !== undefined
    && choiceType !== 'duration_and_aspect_ratio'
    && choiceType !== 'screenplay_review'
    && choiceType !== 'style'
    && choiceType !== 'asset_review'
  ) return null
  return {
    activityId,
    runId,
    type,
    status,
    operationId: readNonEmptyString(data.operationId),
    sourceOperationId: readNonEmptyString(data.sourceOperationId),
    toolCallId: readNonEmptyString(data.toolCallId),
    choiceType: choiceType ?? null,
  }
}

function findLatestWorkspaceAssistantActivityInMessage(message: UIMessage): ProjectAgentSessionActivity | null {
  for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
    const activity = readWorkspaceAssistantActivityPart(message.parts[partIndex])
    if (activity) return activity
  }
  return null
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
  const { save: saveAssistantThread } = useProjectAssistantThreadSync(projectId, episodeId, locale)
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
  const latestSessionStateRef = useRef<ProjectAgentSessionState | null>(null)
  const sessionStateRequestRef = useRef<{
    key: string
    promise: Promise<ProjectAgentSessionState | null>
  } | null>(null)
  const lastPersistedSignatureRef = useRef('[]')
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve())
  const persistTimerRef = useRef<number | null>(null)
  const replyActivitySequenceRef = useRef(0)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [sessionStateError, setSessionStateError] = useState<string | null>(null)
  const [activeControlRun, setActiveControlRun] = useState<WorkspaceAssistantTrackedRun | null>(null)
  const [replyActivity, setReplyActivity] = useState<WorkspaceAssistantReplyActivity | null>(null)
  const [streamedActivity, setStreamedActivity] = useState<ProjectAgentSessionActivity | null>(null)
  const [sessionState, setSessionState] = useState<ProjectAgentSessionState | null>(null)

  useEffect(() => {
    latestMessagesRef.current = chat.messages
  }, [chat.messages])

  useEffect(() => {
    latestSessionStateRef.current = sessionState
  }, [sessionState])

  const beginReplyActivity = useCallback((): number => {
    replyActivitySequenceRef.current += 1
    const sequence = replyActivitySequenceRef.current
    setReplyActivity({
      sequence,
      messageIndex: latestMessagesRef.current.length,
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

  const persistMessagesNow = useCallback(async (messages: UIMessage[]): Promise<boolean> => {
    const validation = validatePersistableUIMessages(messages)
    if (!validation.ok) {
      setSyncError(formatPersistabilityError(validation.error))
      return false
    }
    const signature = JSON.stringify(validation.messages)
    if (signature === lastPersistedSignatureRef.current) return true

    const persistJob = persistQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        await saveAssistantThread(validation.messages)
        lastPersistedSignatureRef.current = signature
        setSyncError(null)
      })
      .catch((error: unknown) => {
        setSyncError(error instanceof Error ? error.message : String(error))
        throw error
      })
    persistQueueRef.current = persistJob

    try {
      await persistJob
      return true
    } catch {
      return false
    }
  }, [saveAssistantThread])

  const replaceMessages = useCallback((messages: UIMessage[]) => {
    const nextMessages = ensureUniqueUIMessages(messages)
    latestMessagesRef.current = nextMessages
    chat.setMessages(nextMessages)
  }, [chat])

  // The user's new message supersedes any pending approval server-side; the
  // stream answers with an interruption-resolved part so the card closes.
  const sendMessage = useCallback(async (text: string) => {
    chat.clearError()
    setStreamedActivity(null)
    const activitySequence = beginReplyActivity()
    try {
      await chat.sendMessage({ text })
      markReplyActivityRequestSettled(activitySequence)
    } catch (error) {
      clearReplyActivity(activitySequence)
      throw error
    }
  }, [beginReplyActivity, chat, clearReplyActivity, markReplyActivityRequestSettled])

  const sendHiddenMessage = useCallback(async (text: string) => {
    chat.clearError()
    setStreamedActivity(null)
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
    const activity = findLatestWorkspaceAssistantActivityInMessage(message)
    if (activity) setStreamedActivity(activity)
    const nextMessages = mergeWorkspaceAssistantStreamedMessage(latestMessagesRef.current, message)
    latestMessagesRef.current = nextMessages
    chat.setMessages(nextMessages)
    return nextMessages
  }, [chat])

  const applySessionState = useCallback((nextState: ProjectAgentSessionState) => {
    latestSessionStateRef.current = nextState
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
    operationId?: string | null
    payload: Record<string, unknown>
    visibleUserText?: string
  }) => {
    chat.clearError()
    setStreamedActivity(null)
    const activitySequence = beginReplyActivity()
    const controlMessageId = createWorkspaceAssistantControlMessageId({
      runId: params.runId,
      endpoint: params.endpoint,
    })
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
        await persistMessagesNow(displayMessages)
      }
      const response = await fetch(
        `/api/projects/${projectId}/assistant/runs/${encodeURIComponent(params.runId)}/${params.endpoint}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            messages: currentMessages,
            context: contextPayload,
            assistantPermissionMode,
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
      await persistMessagesNow(latestMessagesRef.current)
      requestSucceeded = true
    } catch (error) {
      clearReplyActivity(activitySequence)
      throw error
    } finally {
      await refreshSessionState().catch(() => undefined)
      if (requestSucceeded) {
        markReplyActivityRequestSettled(activitySequence)
      }
    }
  }, [
    assistantPermissionMode,
    beginReplyActivity,
    chat,
    clearReplyActivity,
    contextPayload,
    controlTransport,
    markReplyActivityRequestSettled,
    mergeStreamedAssistantMessage,
    persistMessagesNow,
    projectId,
    refreshSessionState,
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

  const addToolApprovalResponse = useCallback(async (params: {
    approvalId: string
    approved: boolean
    reason?: string
  }) => {
    chat.clearError()
    const interaction = latestSessionStateRef.current?.pendingInteraction ?? null
    if (!interaction || interaction.kind !== 'approval' || interaction.approvalId !== params.approvalId) {
      throw new Error('PROJECT_AGENT_INTERRUPTION_NOT_FOUND')
    }
    await sendControlRequest({
      runId: interaction.runId,
      endpoint: 'approval',
      intent: params.approved ? 'approve' : 'deny',
      operationId: interaction.operationId,
      visibleUserText: params.approved ? undefined : params.reason,
      payload: {
        interruptionId: interaction.interruptionId,
        approved: params.approved,
        ...(params.reason ? { reason: params.reason } : {}),
      },
    })
  }, [chat, sendControlRequest])

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
    lastPersistedSignatureRef.current = JSON.stringify(persistedMessages)
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

  useEffect(() => {
    if (hydratedSessionKeyRef.current !== chatId) return
    if (chat.status === 'submitted' || chat.status === 'streaming') return
    if (activeControlRun && isWorkspaceAssistantRunBusyStatus(activeControlRun.status)) return
    const validation = validatePersistableUIMessages(chat.messages)
    if (!validation.ok) {
      setSyncError(formatPersistabilityError(validation.error))
      return
    }
    const signature = JSON.stringify(chat.messages)
    if (signature === lastPersistedSignatureRef.current) return
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current)
    }
    persistTimerRef.current = window.setTimeout(() => {
      void persistMessagesNow(chat.messages)
    }, 400)

    return () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current)
        persistTimerRef.current = null
      }
    }
  }, [activeControlRun, chat.messages, chat.status, chatId, persistMessagesNow])

  useEffect(() => {
    return () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current)
      }
    }
  }, [])

  const emptyApprovalRespondedIds = useMemo<ReadonlySet<string>>(() => new Set<string>(), [])
  const pendingInteraction = sessionState?.pendingInteraction ?? null
  const pendingRunApproval = pendingInteraction?.kind === 'approval' ? pendingInteraction : null
  const streamedRun = useMemo(
    () => findLatestWorkspaceAssistantRun(chat.messages),
    [chat.messages],
  )
  const activeReplyRun = useMemo(
    () => replyActivity
      ? findLatestWorkspaceAssistantRunAtOrAfterMessageIndex(chat.messages, replyActivity.messageIndex)
      : streamedRun,
    [chat.messages, replyActivity, streamedRun],
  )
  const streamedActivityOperationId = resolveOperationIdFromActivity(streamedActivity)
  const streamedActivityOperationRun: WorkspaceAssistantTrackedRun | null = streamedRun
    && isWorkspaceAssistantOperationPendingStatus(streamedRun.status)
    && streamedActivityOperationId
    && (
      chat.status === 'submitted'
      || chat.status === 'streaming'
      || activeControlRun?.runId === streamedRun.runId
    )
    ? {
      ...streamedRun,
      operationId: streamedActivityOperationId,
    }
    : null
  const activeControlOperationRun: WorkspaceAssistantTrackedRun | null = activeControlRun
    ? {
      ...activeControlRun,
      operationId: activeControlRun.operationId
        ?? (streamedActivityOperationRun?.runId === activeControlRun.runId ? streamedActivityOperationRun.operationId : null),
    }
    : null
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
  const pendingRun = activeControlOperationRun ?? streamedActivityOperationRun ?? serverOperationRun
  const pendingOperationId = resolveWorkspaceAssistantPendingOperationId(pendingRun)
  const activeFocusRequest = useMemo(() => resolveWorkspaceAssistantActiveFocusRequest({
    pendingRun,
    operationId: pendingOperationId,
    activities: [
      streamedActivity,
      sessionState?.currentActivity ?? null,
    ],
  }), [
    pendingOperationId,
    pendingRun,
    sessionState?.currentActivity,
    streamedActivity,
  ])
  const controlPending = Boolean(activeControlRun && isWorkspaceAssistantRunBusyStatus(activeControlRun.status))
  const chatReplyInFlight = chat.status === 'submitted' || chat.status === 'streaming'
  const serverRunActive = sessionState?.currentRun?.status === 'running'
  const activeReplyRunStatus = resolveWorkspaceAssistantActiveReplyRunStatus({
    activeReplyRun,
    serverRun: sessionState?.currentRun ?? null,
    replyActivityActive: Boolean(replyActivity),
    chatTransportActive: chatReplyInFlight,
    controlRunActive: controlPending,
  })
  const replyInFlight = resolveWorkspaceAssistantReplyInFlight({
    requestActive: Boolean(replyActivity && !replyActivity.requestSettled),
    chatTransportActive: chatReplyInFlight,
    controlRunActive: controlPending,
    serverRunActive,
    streamedRunStatus: activeReplyRunStatus,
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
    approvalRespondedIds: emptyApprovalRespondedIds,
    sessionState,
    pendingInteraction,
    error: chat.error,
    syncError,
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
    addToolApprovalResponse,
    addRunApprovalResponse,
    replaceMessages,
    appendMessages,
  }
}

export function shouldSendWorkspaceAssistantAutomatically(): boolean {
  return false
}
