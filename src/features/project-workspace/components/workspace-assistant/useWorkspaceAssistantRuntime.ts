'use client'

import {
  getToolName,
  isToolUIPart,
  readUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
} from 'ai'
import {
  useExternalStoreRuntime,
  type AppendMessage,
  type AssistantRuntime,
  type ThreadMessageLike,
} from '@assistant-ui/react'
import { useLocale } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAgentSessionView } from '@/lib/query/hooks'
import type {
  AgentSessionPendingInteractionView,
  AgentSessionSubagentView,
  AgentSessionView,
} from '@/lib/agent-turn/view-contract'
import { apiFetch } from '@/lib/api-fetch'
import {
  buildProjectAssistantTextAttachmentMetadata,
  type ProjectAssistantTextAttachment,
} from '@/lib/project-agent/text-attachments'
import {
  buildProjectAssistantMediaAttachmentMetadata,
  mergeProjectAssistantMessageMetadata,
  type ProjectAssistantMediaAttachment,
} from '@/lib/project-agent/media-attachments'
import { WORKSPACE_SSE_EVENT_TYPE, type AgentTurnStreamSSEEvent } from '@/lib/sse/events'
import { useWorkspaceProvider } from '../../WorkspaceProvider'
import {
  clearWorkspaceAssistantUserMessageReceipt,
  resolveWorkspaceAssistantUserMessageId,
} from './workspace-assistant-command-receipt'
import { useWorkspaceAssistantSubagentStream } from './useWorkspaceAssistantSubagentStream'

export interface WorkspaceAssistantSendMessageInput {
  readonly text: string
  readonly attachments?: readonly ProjectAssistantTextAttachment[]
  readonly mediaAttachments?: readonly ProjectAssistantMediaAttachment[]
  readonly sourceKey?: string
}

interface UseWorkspaceAssistantRuntimeParams {
  projectId: string
  episodeId?: string
  selectedScopeRef?: string | null
  selectedAssetId?: string | null
}

interface UseWorkspaceAssistantRuntimeResult {
  runtime: AssistantRuntime
  messages: UIMessage[]
  pending: boolean
  canStopReply: boolean
  replyInFlight: boolean
  backgroundFollowUpActive: boolean
  view: AgentSessionView | null
  pendingInteraction: AgentSessionPendingInteractionView | null
  error: Error | undefined
  viewError: string | null
  viewLoading: boolean
  subagents: readonly AgentSessionSubagentView[]
  subagentStructuredOutputs: ReadonlyMap<string, string>
  sendMessage: (input: WorkspaceAssistantSendMessageInput) => Promise<void>
  sendHiddenMessage: (text: string, sourceKey?: string) => Promise<void>
  stopReply: () => Promise<void>
  submitChoiceResponse: (params: { response: Record<string, unknown> }) => Promise<void>
  resolveApproval: (params: {
    decision: 'approve' | 'reject'
    reason?: string | null
  }) => Promise<void>
}

type ExternalMessagePart = Exclude<ThreadMessageLike['content'], string>[number]

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function toExternalMessagePart(part: UIMessage['parts'][number]): ExternalMessagePart | null {
  if (part.type === 'text') {
    return { type: 'text', text: part.text }
  }
  if (part.type === 'reasoning') {
    return { type: 'reasoning', text: part.text }
  }
  if (isToolUIPart(part)) {
    const state = part.state
    const result =
      state === 'output-available'
        ? part.output
        : state === 'output-error'
          ? { error: part.errorText }
          : state === 'output-denied'
            ? {
                error:
                  isRecord(part.approval) && typeof part.approval.reason === 'string'
                    ? part.approval.reason
                    : 'PROJECT_AGENT_TOOL_APPROVAL_REJECTED',
              }
            : undefined
    return {
      type: 'tool-call',
      toolName: getToolName(part),
      toolCallId: part.toolCallId,
      argsText: JSON.stringify(part.input ?? {}),
      result,
      isError: state === 'output-error' || state === 'output-denied',
    }
  }
  if (part.type === 'source-url') {
    return {
      type: 'source',
      sourceType: 'url',
      id: part.sourceId,
      url: part.url,
      ...(part.title ? { title: part.title } : {}),
    }
  }
  if (part.type === 'file') {
    return {
      type: 'file',
      data: part.url,
      mimeType: part.mediaType,
      ...(part.filename ? { filename: part.filename } : {}),
    }
  }
  if (part.type.startsWith('data-') && 'data' in part) {
    return {
      type: 'data',
      name: part.type.slice(5),
      data: part.data,
    }
  }
  return null
}

function convertUiMessage(message: UIMessage): ThreadMessageLike {
  const content = message.parts.flatMap((part) => {
    if (part.type === 'step-start') return []
    const converted = toExternalMessagePart(part)
    return converted ? [converted] : []
  })
  return {
    id: message.id,
    role: message.role,
    content,
    createdAt: new Date(),
    metadata: isRecord(message.metadata)
      ? (message.metadata as ThreadMessageLike['metadata'])
      : { custom: {} },
  }
}

class WorkspaceAssistantCommandError extends Error {
  readonly outcome: 'rejected' | 'unconfirmed'

  constructor(message: string, outcome: 'rejected' | 'unconfirmed') {
    super(message)
    this.name = 'WorkspaceAssistantCommandError'
    this.outcome = outcome
  }
}

async function readCommandError(
  response: Response,
  fallback: string,
): Promise<WorkspaceAssistantCommandError> {
  const payload: unknown = await response.json().catch(() => null)
  const outcome = response.status >= 500 ? 'unconfirmed' : 'rejected'
  if (isRecord(payload)) {
    const code = typeof payload.code === 'string' ? payload.code : null
    const message = typeof payload.message === 'string' ? payload.message : null
    const requestId = typeof payload.requestId === 'string' ? payload.requestId : null
    if (code || message) {
      return new WorkspaceAssistantCommandError(
        [code, message, requestId].filter(Boolean).join(':'),
        outcome,
      )
    }
  }
  return new WorkspaceAssistantCommandError(`${fallback}:${String(response.status)}`, outcome)
}

function normalizeWorkspaceAssistantCommandError(error: unknown): {
  error: Error
  outcome: 'rejected' | 'unconfirmed'
} {
  if (error instanceof WorkspaceAssistantCommandError) {
    return { error, outcome: error.outcome }
  }
  return {
    error: new WorkspaceAssistantCommandError('AGENT_TEMPORAL_UNAVAILABLE', 'unconfirmed'),
    outcome: 'unconfirmed',
  }
}

function createUserMessage(params: {
  id: string
  text: string
  attachments: readonly ProjectAssistantTextAttachment[]
  mediaAttachments: readonly ProjectAssistantMediaAttachment[]
  hidden: boolean
}): UIMessage {
  const metadata = mergeProjectAssistantMessageMetadata(
    buildProjectAssistantTextAttachmentMetadata(params.attachments),
    buildProjectAssistantMediaAttachmentMetadata(params.mediaAttachments),
  )
  const metadataRecord: Record<string, unknown> = isRecord(metadata) ? metadata : {}
  const custom = {
    ...(isRecord(metadataRecord.custom) ? metadataRecord.custom : {}),
    ...(params.hidden ? { workspaceAssistantHidden: true } : {}),
  }
  return {
    id: params.id,
    role: 'user',
    parts: params.text ? [{ type: 'text', text: params.text }] : [],
    metadata: {
      ...metadataRecord,
      custom,
    },
  }
}

function readAppendMessageText(message: AppendMessage): string {
  return message.content
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n')
    .trim()
}

function isActiveTurn(view: AgentSessionView | null): boolean {
  return (
    view?.currentTurn?.status === 'queued' ||
    view?.currentTurn?.status === 'running' ||
    view?.currentTurn?.status === 'waiting_approval'
  )
}

function useAgentTurnOverlay(params: {
  projectId: string
  episodeId: string | null
  view: AgentSessionView | null
}): UIMessage | null {
  const { subscribeTaskEvents } = useWorkspaceProvider()
  const [message, setMessage] = useState<UIMessage | null>(null)
  const activeRef = useRef<{
    identity: string
    lastSeq: number
    controller: ReadableStreamDefaultController<UIMessageChunk>
  } | null>(null)
  const generationRef = useRef(0)

  const close = useCallback(() => {
    generationRef.current += 1
    const active = activeRef.current
    activeRef.current = null
    if (active) {
      try {
        active.controller.close()
      } catch {}
    }
    setMessage(null)
  }, [])

  const start = useCallback(
    (event: AgentTurnStreamSSEEvent) => {
      close()
      const generation = generationRef.current
      let controller: ReadableStreamDefaultController<UIMessageChunk> | null = null
      const stream = new ReadableStream<UIMessageChunk>({
        start(nextController) {
          controller = nextController
        },
      })
      if (!controller) {
        throw new Error('AGENT_TURN_OVERLAY_CONTROLLER_MISSING')
      }
      activeRef.current = {
        identity: `${event.turnId}:${String(event.attempt)}:${event.messageId}`,
        lastSeq: 0,
        controller,
      }
      void (async () => {
        try {
          for await (const nextMessage of readUIMessageStream({
            stream,
            terminateOnError: true,
            message: {
              id: event.messageId,
              role: 'assistant',
              parts: [],
            },
          })) {
            if (generationRef.current !== generation) return
            setMessage(nextMessage)
          }
        } catch {
          if (generationRef.current === generation) close()
        }
      })()
    },
    [close],
  )

  useEffect(
    () =>
      subscribeTaskEvents((event) => {
        if (event.type !== WORKSPACE_SSE_EVENT_TYPE.AGENT_TURN_STREAM) return
        if (event.projectId !== params.projectId || event.episodeId !== params.episodeId) {
          return
        }
        const identity = `${event.turnId}:${String(event.attempt)}:${event.messageId}`
        if (activeRef.current?.identity !== identity) start(event)
        const active = activeRef.current
        if (!active || active.identity !== identity) return
        if (event.seq <= active.lastSeq) return
        if (event.seq !== active.lastSeq + 1) {
          close()
          return
        }
        active.lastSeq = event.seq
        try {
          active.controller.enqueue(event.chunk)
        } catch {
          close()
        }
      }),
    [close, params.episodeId, params.projectId, start, subscribeTaskEvents],
  )

  useEffect(() => {
    const active = activeRef.current
    if (!active) return
    const turn = params.view?.currentTurn ?? null
    const expectedPrefix = turn ? `${turn.turnId}:${String(turn.attempt)}:` : null
    const persisted = params.view?.thread?.messages.some(
      (candidate) => candidate.id === message?.id,
    )
    if (
      persisted ||
      !turn ||
      turn.status !== 'running' ||
      !active.identity.startsWith(expectedPrefix ?? '\u0000')
    ) {
      close()
    }
  }, [close, message?.id, params.view])

  useEffect(() => close, [close])
  return message
}

export function useWorkspaceAssistantRuntime({
  projectId,
  episodeId,
  selectedScopeRef,
  selectedAssetId,
}: UseWorkspaceAssistantRuntimeParams): UseWorkspaceAssistantRuntimeResult {
  const locale = useLocale()
  const viewQuery = useAgentSessionView(projectId, episodeId)
  const refetchAgentSessionView = viewQuery.refetch
  const view = viewQuery.data ?? null
  const scopeKey = `${projectId}:${episodeId ?? ''}`
  const scopeKeyRef = useRef(scopeKey)
  scopeKeyRef.current = scopeKey
  const overlay = useAgentTurnOverlay({
    projectId,
    episodeId: episodeId ?? null,
    view,
  })
  const [optimisticState, setOptimisticState] = useState<{
    scopeKey: string
    messages: UIMessage[]
  }>(() => ({ scopeKey, messages: [] }))
  const [commandPendingState, setCommandPendingState] = useState<{
    scopeKey: string
    value: boolean
  }>(() => ({ scopeKey, value: false }))
  const [commandErrorState, setCommandErrorState] = useState<{
    scopeKey: string
    value: Error | null
  }>(() => ({ scopeKey, value: null }))
  const optimisticMessages = useMemo(
    () => (optimisticState.scopeKey === scopeKey ? optimisticState.messages : []),
    [optimisticState, scopeKey],
  )
  const commandPending =
    commandPendingState.scopeKey === scopeKey ? commandPendingState.value : false
  const commandError = commandErrorState.scopeKey === scopeKey ? commandErrorState.value : null
  const setOptimisticMessages = useCallback(
    (update: UIMessage[] | ((current: UIMessage[]) => UIMessage[])) => {
      setOptimisticState((current) => {
        const messages = current.scopeKey === scopeKey ? current.messages : []
        return {
          scopeKey,
          messages: typeof update === 'function' ? update(messages) : update,
        }
      })
    },
    [scopeKey],
  )
  const setCommandPending = useCallback(
    (value: boolean) => {
      setCommandPendingState({ scopeKey, value })
    },
    [scopeKey],
  )
  const setCommandError = useCallback(
    (value: Error | null) => {
      setCommandErrorState({ scopeKey, value })
    },
    [scopeKey],
  )
  const persistedMessages = useMemo(
    () => [...(view?.thread?.messages ?? [])],
    [view?.thread?.messages],
  )
  const refetchView = useCallback(async (): Promise<AgentSessionView | null> => {
    const result = await refetchAgentSessionView({ cancelRefetch: true })
    if (result.error) return null
    return result.data ?? null
  }, [refetchAgentSessionView])
  const subagentStream = useWorkspaceAssistantSubagentStream({
    projectId,
    episodeId: episodeId ?? null,
    view,
    refetchView,
  })

  useEffect(() => {
    const persistedIds = new Set(persistedMessages.map((item) => item.id))
    for (const messageId of persistedIds) {
      clearWorkspaceAssistantUserMessageReceipt({ scopeKey, messageId })
    }
    setOptimisticMessages((current) => current.filter((item) => !persistedIds.has(item.id)))
  }, [persistedMessages, scopeKey, setOptimisticMessages])

  const messages = useMemo(() => {
    const next = [...persistedMessages]
    const ids = new Set(next.map((message) => message.id))
    for (const message of optimisticMessages) {
      if (!ids.has(message.id)) {
        next.push(message)
        ids.add(message.id)
      }
    }
    if (overlay && !ids.has(overlay.id)) next.push(overlay)
    return next
  }, [optimisticMessages, overlay, persistedMessages])

  const submitUserMessage = useCallback(
    async (input: WorkspaceAssistantSendMessageInput, hidden: boolean): Promise<void> => {
      const text = input.text.trim()
      const attachments = input.attachments ?? []
      const mediaAttachments = input.mediaAttachments ?? []
      if (!text && attachments.length === 0 && mediaAttachments.length === 0) {
        return
      }
      const commandScopeKey = scopeKey
      const id = await resolveWorkspaceAssistantUserMessageId({
        scopeKey: commandScopeKey,
        sourceKey: input.sourceKey,
        immutableInput: {
          text,
          attachments,
          mediaAttachments,
          hidden,
        },
      })
      if (scopeKeyRef.current !== commandScopeKey) return
      const message = createUserMessage({
        id,
        text,
        attachments,
        mediaAttachments,
        hidden,
      })
      setCommandError(null)
      setCommandPending(true)
      setOptimisticMessages((current) => [
        ...current.filter((candidate) => candidate.id !== message.id),
        message,
      ])
      try {
        const response = await apiFetch(
          `/api/projects/${encodeURIComponent(projectId)}/assistant/chat`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              message,
              context: {
                locale,
                episodeId: episodeId ?? null,
                selectedScopeRef: selectedScopeRef ?? null,
                selectedAssetId: selectedAssetId ?? null,
              },
            }),
          },
        )
        if (!response.ok) {
          throw await readCommandError(response, 'AGENT_TURN_SUBMIT_REQUEST_FAILED')
        }
        const refreshed = await refetchView()
        if (refreshed?.thread?.messages.some((candidate) => candidate.id === id)) {
          clearWorkspaceAssistantUserMessageReceipt({
            scopeKey: commandScopeKey,
            messageId: id,
          })
        }
      } catch (error) {
        const normalized = normalizeWorkspaceAssistantCommandError(error)
        if (scopeKeyRef.current === commandScopeKey) {
          if (normalized.outcome === 'rejected') {
            setOptimisticMessages((current) => current.filter((item) => item.id !== id))
          }
          setCommandError(normalized.error)
        }
        throw normalized.error
      } finally {
        if (scopeKeyRef.current === commandScopeKey) {
          setCommandPending(false)
        }
      }
    },
    [
      episodeId,
      locale,
      projectId,
      selectedAssetId,
      selectedScopeRef,
      refetchView,
      scopeKey,
      setCommandError,
      setCommandPending,
      setOptimisticMessages,
    ],
  )

  const sendMessage = useCallback(
    async (input: WorkspaceAssistantSendMessageInput) => {
      await submitUserMessage(input, false)
    },
    [submitUserMessage],
  )
  const sendHiddenMessage = useCallback(
    async (text: string, sourceKey?: string) => {
      await submitUserMessage({ text, sourceKey }, true)
    },
    [submitUserMessage],
  )

  const stopReply = useCallback(async () => {
    const turn = view?.currentTurn
    const threadId = view?.thread?.threadId
    if (!turn || !threadId || !isActiveTurn(view)) return
    const commandScopeKey = scopeKey
    setCommandError(null)
    setCommandPending(true)
    try {
      const response = await apiFetch(
        `/api/projects/${encodeURIComponent(projectId)}/assistant/turns/${encodeURIComponent(turn.turnId)}/cancel`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            threadId,
            requestId: `turn-cancel:${turn.turnId}:user`,
            reason: 'user_cancelled',
          }),
        },
      )
      if (!response.ok) {
        throw await readCommandError(response, 'AGENT_TURN_CANCEL_REQUEST_FAILED')
      }
      await refetchView()
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error))
      if (scopeKeyRef.current === commandScopeKey) {
        setCommandError(normalized)
      }
      throw normalized
    } finally {
      if (scopeKeyRef.current === commandScopeKey) {
        setCommandPending(false)
      }
    }
  }, [projectId, refetchView, scopeKey, setCommandError, setCommandPending, view])

  const resolveApproval = useCallback(
    async (params: { decision: 'approve' | 'reject'; reason?: string | null }) => {
      const interaction =
        view?.pendingInteraction?.kind === 'approval' ? view.pendingInteraction : null
      const threadId = view?.thread?.threadId
      if (!interaction || !threadId) {
        throw new Error('AGENT_TURN_APPROVAL_NOT_PENDING')
      }
      const commandScopeKey = scopeKey
      setCommandError(null)
      setCommandPending(true)
      try {
        const response = await apiFetch(
          `/api/projects/${encodeURIComponent(projectId)}/assistant/turns/${encodeURIComponent(interaction.turnId)}/approval`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              threadId,
              interactionId: interaction.interactionId,
              requestId: `approval:${interaction.interactionId}:${params.decision}`,
              decision: params.decision,
              reason: params.reason ?? null,
            }),
          },
        )
        if (!response.ok) {
          throw await readCommandError(response, 'AGENT_TURN_APPROVAL_REQUEST_FAILED')
        }
        await refetchView()
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error))
        if (scopeKeyRef.current === commandScopeKey) {
          setCommandError(normalized)
        }
        throw normalized
      } finally {
        if (scopeKeyRef.current === commandScopeKey) {
          setCommandPending(false)
        }
      }
    },
    [
      projectId,
      refetchView,
      scopeKey,
      setCommandError,
      setCommandPending,
      view?.pendingInteraction,
      view?.thread?.threadId,
    ],
  )

  const submitChoiceResponse = useCallback(
    async (params: { response: Record<string, unknown> }) => {
      const interaction =
        view?.pendingInteraction?.kind === 'choice' ? view.pendingInteraction : null
      const threadId = view?.thread?.threadId
      if (!interaction || !threadId) {
        throw new Error('AGENT_TURN_CHOICE_NOT_PENDING')
      }
      const commandScopeKey = scopeKey
      setCommandError(null)
      setCommandPending(true)
      try {
        const response = await apiFetch(
          `/api/projects/${encodeURIComponent(projectId)}/assistant/choices/${encodeURIComponent(interaction.interactionId)}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              threadId,
              requestId: `choice:${interaction.interactionId}`,
              response: params.response,
            }),
          },
        )
        if (!response.ok) {
          throw await readCommandError(response, 'AGENT_TURN_CHOICE_REQUEST_FAILED')
        }
        await refetchView()
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error))
        if (scopeKeyRef.current === commandScopeKey) {
          setCommandError(normalized)
        }
        throw normalized
      } finally {
        if (scopeKeyRef.current === commandScopeKey) {
          setCommandPending(false)
        }
      }
    },
    [
      projectId,
      refetchView,
      scopeKey,
      setCommandError,
      setCommandPending,
      view?.pendingInteraction,
      view?.thread?.threadId,
    ],
  )

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const text = readAppendMessageText(message)
      if (text) await sendMessage({ text })
    },
    [sendMessage],
  )
  const replyInFlight =
    view?.currentTurn?.status === 'queued' || view?.currentTurn?.status === 'running'
  const runtime = useExternalStoreRuntime<UIMessage>({
    messages,
    isLoading: viewQuery.isLoading,
    isRunning: replyInFlight,
    onNew,
    onCancel: stopReply,
    convertMessage: convertUiMessage,
  })
  const backgroundFollowUpActive =
    replyInFlight && view?.currentTurn?.sourceKind === 'task_follow_up'

  return {
    runtime,
    messages,
    pending: commandPending,
    canStopReply: Boolean(view?.thread && isActiveTurn(view)),
    replyInFlight,
    backgroundFollowUpActive,
    view,
    pendingInteraction: view?.pendingInteraction ?? null,
    error: commandError ?? undefined,
    viewError:
      viewQuery.error instanceof Error
        ? viewQuery.error.message
        : viewQuery.error
          ? String(viewQuery.error)
          : null,
    viewLoading: viewQuery.isLoading,
    subagents: subagentStream.subagents,
    subagentStructuredOutputs: subagentStream.structuredOutputs,
    sendMessage,
    sendHiddenMessage,
    stopReply,
    submitChoiceResponse,
    resolveApproval,
  }
}
