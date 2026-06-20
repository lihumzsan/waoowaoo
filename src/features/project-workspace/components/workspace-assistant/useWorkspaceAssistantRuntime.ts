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
  ProjectAgentSessionPendingInteraction,
  ProjectAgentSessionState,
} from '@/lib/project-agent/session-state'
import {
  ensureUniqueUIMessages,
  validatePersistableUIMessages,
  type UIMessagesPersistabilityError,
} from '@/lib/project-agent/ui-message-validation'
import type { AssistantPermissionMode } from '@/lib/project-agent/permission-mode'

export type WorkspaceAssistantChoiceType = 'duration_and_aspect_ratio' | 'screenplay_review' | 'style' | 'asset_review'
type WorkspaceAssistantControlEndpoint = 'approval' | 'choice' | 'task-follow-up'
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
  sessionState: ProjectAgentSessionState | null
  pendingInteraction: ProjectAgentSessionPendingInteraction | null
  error: Error | undefined
  syncError: string | null
  sessionStateError: string | null
  storageError: string | null
  storageLoading: boolean
  pendingOperationId: string | null
  pendingRunApproval: WorkspaceAssistantPendingApproval | null
  sendMessage: (text: string) => Promise<void>
  sendHiddenMessage: (text: string) => Promise<void>
  submitChoiceResponse: (params: {
    runId: string
    interruptionId: string | null
    choiceType: WorkspaceAssistantChoiceType
    toolCallId: string | null
    output: Record<string, unknown>
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

export function isWorkspaceAssistantOperationPendingStatus(status: WorkspaceAssistantRunStatus): boolean {
  return status === 'running' || status === 'awaiting_task'
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

export function shouldClearWorkspaceAssistantControlPending(status: WorkspaceAssistantRunStatus): boolean {
  return !isWorkspaceAssistantOperationPendingStatus(status)
}

function isActiveWorkspaceAssistantSessionRunStatus(status: WorkspaceAssistantRunStatus): boolean {
  return status === 'running'
    || status === 'awaiting_approval'
    || status === 'awaiting_choice'
    || status === 'awaiting_task'
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

function isWorkspaceAssistantStreamingOperationTool(toolName: string): boolean {
  return toolName.startsWith('generate_')
    || toolName.startsWith('revise_')
    || toolName === 'render_final_video'
}

function readRunScopedOperation(part: unknown, runId: string, allowUnscopedOperation: boolean): string | null {
  if (!isRecord(part)) return null
  const data = isRecord(part.data) ? part.data : null

  if (part.type === 'dynamic-tool' && allowUnscopedOperation) {
    const toolName = readNonEmptyString(part.toolName)
    return toolName && isWorkspaceAssistantStreamingOperationTool(toolName) ? toolName : null
  }

  if (!data) return null

  if (part.type === 'data-agent-interruption') {
    return readNonEmptyString(data.runId) === runId
      ? readNonEmptyString(data.operationId)
      : null
  }

  if (part.type === 'data-task-submitted' || part.type === 'data-task-batch-submitted') {
    const partRunId = readNonEmptyString(data.runId)
    return partRunId === runId || (!partRunId && allowUnscopedOperation)
      ? readNonEmptyString(data.operationId)
      : null
  }

  if (part.type === 'data-agent-stop' && allowUnscopedOperation) {
    const operationIds = Array.isArray(data.operationIds)
      ? data.operationIds.map(readNonEmptyString).filter((item): item is string => Boolean(item))
      : []
    return operationIds[0] ?? null
  }

  return null
}

function findLatestRunOperationId(messages: readonly UIMessage[], runId: string, runMessageIndex: number): string | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (!message || message.role !== 'assistant') continue
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const operationId = readRunScopedOperation(message.parts[partIndex], runId, messageIndex >= runMessageIndex)
      if (operationId) return operationId
    }
  }
  return null
}

export function findLatestWorkspaceAssistantRun(messages: readonly UIMessage[]): WorkspaceAssistantTrackedRun | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (!message || message.role !== 'assistant') continue
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const run = readWorkspaceAssistantRunPart(message.parts[partIndex])
      if (run) {
        return {
          ...run,
          operationId: findLatestRunOperationId(messages, run.runId, messageIndex),
        }
      }
    }
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
  const controlTransport = useMemo(() => new WorkspaceAssistantControlTransport(), [])
  const hydratedSessionKeyRef = useRef<string | null>(null)
  const latestMessagesRef = useRef<UIMessage[]>(chat.messages)
  const latestSessionStateRef = useRef<ProjectAgentSessionState | null>(null)
  const lastPersistedSignatureRef = useRef('[]')
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve())
  const persistTimerRef = useRef<number | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [sessionStateError, setSessionStateError] = useState<string | null>(null)
  const [activeControlRun, setActiveControlRun] = useState<WorkspaceAssistantTrackedRun | null>(null)
  const [sessionState, setSessionState] = useState<ProjectAgentSessionState | null>(null)

  useEffect(() => {
    latestMessagesRef.current = chat.messages
  }, [chat.messages])

  useEffect(() => {
    latestSessionStateRef.current = sessionState
  }, [sessionState])

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
    latestSessionStateRef.current = nextState
    setSessionState(nextState)
    const currentRun = nextState.currentRun
    if (!currentRun) {
      setActiveControlRun(null)
      return
    }
    if (isWorkspaceAssistantOperationPendingStatus(currentRun.status)) {
      setActiveControlRun((current) => ({
        runId: currentRun.runId,
        status: currentRun.status,
        operationId: currentRun.operationId ?? (current?.runId === currentRun.runId ? current.operationId : null),
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
    try {
      const nextState = await fetchWorkspaceAssistantSessionState({ projectId, episodeId, locale })
      applySessionState(nextState)
      setSessionStateError(null)
      return nextState
    } catch (error) {
      setSessionStateError(error instanceof Error ? error.message : String(error))
      return null
    }
  }, [applySessionState, episodeId, locale, projectId])

  const sendControlRequest = useCallback(async (params: {
    runId: string
    endpoint: WorkspaceAssistantControlEndpoint
    intent: WorkspaceAssistantControlIntent
    operationId?: string | null
    payload: Record<string, unknown>
  }) => {
    chat.clearError()
    setActiveControlRun({
      runId: params.runId,
      status: 'running',
      operationId: params.operationId ?? null,
      intent: params.intent,
    })
    try {
      const controlMessageId = createWorkspaceAssistantControlMessageId({
        runId: params.runId,
        endpoint: params.endpoint,
      })
      const response = await fetch(
        `/api/projects/${projectId}/assistant/runs/${encodeURIComponent(params.runId)}/${params.endpoint}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            messages: latestMessagesRef.current.length > 0 ? latestMessagesRef.current : chat.messages,
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
    } finally {
      await refreshSessionState().catch(() => undefined)
    }
  }, [
    assistantPermissionMode,
    chat,
    contextPayload,
    controlTransport,
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
  }) => {
    await sendControlRequest({
      runId: params.runId,
      endpoint: 'choice',
      intent: 'choice',
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
    const hasActiveSessionState = Boolean(
      sessionState?.currentRun && isActiveWorkspaceAssistantSessionRunStatus(sessionState.currentRun.status),
    ) || Boolean(sessionState?.pendingInteraction) || Boolean(sessionState?.activeWaits.some((wait) => wait.status === 'pending'))
    const shouldPoll = chat.status === 'submitted'
      || chat.status === 'streaming'
      || Boolean(activeControlRun && isWorkspaceAssistantRunBusyStatus(activeControlRun.status))
      || hasActiveSessionState
    if (!shouldPoll) return
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
  }, [activeControlRun, chat.status, refreshSessionState, sessionState])

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
  const streamedOperationRun: WorkspaceAssistantTrackedRun | null = streamedRun
    && isWorkspaceAssistantOperationPendingStatus(streamedRun.status)
    && (
      chat.status === 'submitted'
      || chat.status === 'streaming'
      || activeControlRun?.runId === streamedRun.runId
    )
    ? streamedRun
    : null
  const activeControlOperationRun: WorkspaceAssistantTrackedRun | null = activeControlRun
    ? {
      ...activeControlRun,
      operationId: activeControlRun.operationId
        ?? (streamedOperationRun?.runId === activeControlRun.runId ? streamedOperationRun.operationId : null),
    }
    : null
  const serverOperationRun: WorkspaceAssistantTrackedRun | null = sessionState?.currentRun
    && isWorkspaceAssistantOperationPendingStatus(sessionState.currentRun.status)
    ? {
      runId: sessionState.currentRun.runId,
      status: sessionState.currentRun.status,
      operationId: sessionState.currentRun.operationId,
      intent: null,
    }
    : null
  const pendingRun = activeControlOperationRun ?? streamedOperationRun ?? serverOperationRun
  const pendingOperationId = resolveWorkspaceAssistantPendingOperationId(pendingRun)

  return {
    runtime,
    messages: chat.messages,
    messageCount: chat.messages.length,
    status: chat.status,
    pending: Boolean(pendingRun) || chat.status === 'submitted' || chat.status === 'streaming',
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
