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
import {
  ensureUniqueUIMessages,
  validatePersistableUIMessages,
  type UIMessagesPersistabilityError,
} from '@/lib/project-agent/ui-message-validation'
import {
  collectResolvedInterruptionApprovalIds,
  findPendingToolApprovalId,
  findPendingWorkspaceAssistantInterruption,
} from './interruption-parts'
import type { AssistantPermissionMode } from '@/lib/project-agent/permission-mode'

export type WorkspaceAssistantChoiceType = 'duration_and_aspect_ratio' | 'screenplay_review' | 'style'
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

interface WorkspaceAssistantPendingApproval {
  runId: string
  interruptionId: string
  approvalId: string
  operationId: string
}

interface WorkspaceAssistantRunSnapshot {
  status: WorkspaceAssistantRunStatus
  pendingApproval: WorkspaceAssistantPendingApproval | null
}

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
  error: Error | undefined
  syncError: string | null
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

/**
 * The operation-running affordance is only meaningful when the tracked control
 * action actually executes the operation. Denying an approval merely delivers
 * the rejection to the agent, so no operation is pending.
 */
export function resolveWorkspaceAssistantPendingOperationId(
  trackedRun: Pick<WorkspaceAssistantTrackedRun, 'operationId' | 'intent'> | null,
): string | null {
  if (!trackedRun || trackedRun.intent === 'deny') return null
  return trackedRun.operationId
}

export function shouldClearWorkspaceAssistantControlPending(status: WorkspaceAssistantRunStatus): boolean {
  return !isWorkspaceAssistantRunBusyStatus(status)
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
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (!message || message.role !== 'assistant') continue
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const run = readWorkspaceAssistantRunPart(message.parts[partIndex])
      if (run) return run
    }
  }
  return null
}

function readPendingApproval(payload: unknown, runId: string): WorkspaceAssistantPendingApproval | null {
  if (!isRecord(payload)) return null
  const interruptionId = readNonEmptyString(payload.interruptionId)
  const approvalId = readNonEmptyString(payload.approvalId)
  const operationId = readNonEmptyString(payload.operationId)
  if (!interruptionId || !approvalId || !operationId) return null
  return {
    runId,
    interruptionId,
    approvalId,
    operationId,
  }
}

async function fetchWorkspaceAssistantRunSnapshot(params: {
  projectId: string
  episodeId?: string | null
  runId: string
}): Promise<WorkspaceAssistantRunSnapshot> {
  const query = params.episodeId ? `?episodeId=${encodeURIComponent(params.episodeId)}` : ''
  const response = await apiFetch(
    `/api/projects/${params.projectId}/assistant/runs/${encodeURIComponent(params.runId)}${query}`,
  )
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok || !isRecord(payload)) {
    throw new Error('PROJECT_AGENT_RUN_STATUS_FETCH_FAILED')
  }
  const run = isRecord(payload.run) ? payload.run : null
  if (!isWorkspaceAssistantRunStatus(run?.status)) {
    throw new Error('PROJECT_AGENT_RUN_STATUS_INVALID')
  }
  return {
    status: run.status,
    pendingApproval: readPendingApproval(payload.pendingApproval, params.runId),
  }
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
  const lastPersistedSignatureRef = useRef('[]')
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve())
  const persistTimerRef = useRef<number | null>(null)
  const settledRunIdsRef = useRef<Set<string>>(new Set())
  const [syncError, setSyncError] = useState<string | null>(null)
  const [activeControlRun, setActiveControlRun] = useState<WorkspaceAssistantTrackedRun | null>(null)
  const [pendingRunApproval, setPendingRunApproval] = useState<WorkspaceAssistantPendingApproval | null>(null)

  useEffect(() => {
    latestMessagesRef.current = chat.messages
  }, [chat.messages])

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

  const applyTrackedRunStatus = useCallback((params: {
    runId: string
    status: WorkspaceAssistantRunStatus
    operationId?: string | null
    intent?: WorkspaceAssistantControlIntent | null
    pendingApproval?: WorkspaceAssistantPendingApproval | null
  }) => {
    const { runId, status } = params
    if (status === 'awaiting_approval' && params.pendingApproval) {
      settledRunIdsRef.current.add(runId)
      setActiveControlRun((current) => current?.runId === runId ? null : current)
      setPendingRunApproval(params.pendingApproval)
      return
    }
    setPendingRunApproval((current) => current?.runId === runId ? null : current)
    if (shouldClearWorkspaceAssistantControlPending(status)) {
      settledRunIdsRef.current.add(runId)
      setActiveControlRun((current) => current?.runId === runId ? null : current)
      return
    }
    setActiveControlRun((current) => ({
      runId,
      status,
      operationId: params.operationId ?? (current?.runId === runId ? current.operationId : null),
      intent: params.intent ?? (current?.runId === runId ? current.intent : null),
    }))
  }, [])

  const refreshTrackedRunStatus = useCallback(async (runId: string): Promise<WorkspaceAssistantRunStatus> => {
    const snapshot = await fetchWorkspaceAssistantRunSnapshot({ projectId, episodeId, runId })
    applyTrackedRunStatus({ runId, status: snapshot.status, pendingApproval: snapshot.pendingApproval })
    return snapshot.status
  }, [applyTrackedRunStatus, episodeId, projectId])

  const sendControlRequest = useCallback(async (params: {
    runId: string
    endpoint: WorkspaceAssistantControlEndpoint
    intent: WorkspaceAssistantControlIntent
    operationId?: string | null
    payload: Record<string, unknown>
  }) => {
    chat.clearError()
    settledRunIdsRef.current.delete(params.runId)
    setPendingRunApproval((current) => current?.runId === params.runId ? null : current)
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
      await refreshTrackedRunStatus(params.runId).catch(() => undefined)
    }
  }, [
    assistantPermissionMode,
    chat,
    contextPayload,
    controlTransport,
    mergeStreamedAssistantMessage,
    persistMessagesNow,
    projectId,
    refreshTrackedRunStatus,
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
    const interruption = findPendingWorkspaceAssistantInterruption(chat.messages)
    if (!interruption || interruption.approvalId !== params.approvalId) {
      throw new Error('PROJECT_AGENT_INTERRUPTION_NOT_FOUND')
    }
    await sendControlRequest({
      runId: interruption.runId,
      endpoint: 'approval',
      intent: params.approved ? 'approve' : 'deny',
      operationId: interruption.operationId,
      payload: {
        interruptionId: interruption.interruptionId,
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
    const latestRun = findLatestWorkspaceAssistantRun(chat.messages)
    if (!latestRun) return
    if (!isWorkspaceAssistantRunBusyStatus(latestRun.status)) {
      applyTrackedRunStatus(latestRun)
      return
    }
    if (settledRunIdsRef.current.has(latestRun.runId)) return
    if (chat.status === 'submitted' || chat.status === 'streaming') return
    setActiveControlRun((current) => current?.runId === latestRun.runId
      ? current
      : latestRun)
  }, [applyTrackedRunStatus, chat.messages, chat.status])

  useEffect(() => {
    if (!activeControlRun || !isWorkspaceAssistantRunBusyStatus(activeControlRun.status)) return
    let cancelled = false
    let timer: number | null = null

    const poll = () => {
      timer = window.setTimeout(() => {
        void refreshTrackedRunStatus(activeControlRun.runId)
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
  }, [activeControlRun, refreshTrackedRunStatus])

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

  return {
    runtime,
    messages: chat.messages,
    messageCount: chat.messages.length,
    status: chat.status,
    pending: Boolean(activeControlRun) || chat.status === 'submitted' || chat.status === 'streaming',
    pendingApprovalId: findPendingToolApprovalId(chat.messages) ?? pendingRunApproval?.approvalId ?? null,
    approvalRespondedIds: collectResolvedInterruptionApprovalIds(chat.messages),
    error: chat.error,
    syncError,
    storageError: assistantThread.error?.message || null,
    storageLoading: assistantThread.isLoading,
    pendingOperationId: resolveWorkspaceAssistantPendingOperationId(activeControlRun),
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
