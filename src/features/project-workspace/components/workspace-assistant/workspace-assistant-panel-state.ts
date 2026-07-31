import type { UIMessage } from 'ai'
import { parseApiErrorPayload } from '@/lib/api-error-payload'
import type { AgentTurnSourceKind } from '@/lib/agent-turn/contracts'
import {
  readProjectAssistantTextAttachmentsFromMessage,
  type ProjectAssistantTextAttachment,
} from '@/lib/project-agent/text-attachments'
import {
  readProjectAssistantMediaAttachmentsFromMessage,
  type ProjectAssistantMediaAttachment,
} from '@/lib/project-agent/media-attachments'
import type {
  ProjectAgentSubagentEventPartData,
  ProjectAgentSubagentStatus,
} from '@/lib/project-agent/subagent-events'

export const WORKSPACE_ASSISTANT_ACTIVE_OPERATION_PRESENTATIONS = {
} as const

export type WorkspaceAssistantActiveOperationPresentation =
  | (typeof WORKSPACE_ASSISTANT_ACTIVE_OPERATION_PRESENTATIONS)[keyof typeof WORKSPACE_ASSISTANT_ACTIVE_OPERATION_PRESENTATIONS]
  | 'genericRun'

export function resolveWorkspaceAssistantActiveOperationPresentation(
  operationId: string | null | undefined,
): WorkspaceAssistantActiveOperationPresentation | null {
  if (!operationId) return null
  return WORKSPACE_ASSISTANT_ACTIVE_OPERATION_PRESENTATIONS[
    operationId as keyof typeof WORKSPACE_ASSISTANT_ACTIVE_OPERATION_PRESENTATIONS
  ] ?? 'genericRun'
}

export function shouldShowWorkspaceAssistantReplyLoading(params: {
  storageLoading: boolean
  replyInFlight: boolean
  hasPendingInteraction: boolean
}): boolean {
  return !params.storageLoading
    && params.replyInFlight
    && !params.hasPendingInteraction
}

export function shouldShowWorkspaceAssistantRunFailureNotice(params: {
  storageLoading: boolean
  replyInFlight: boolean
  currentTurnStatus?: string | null
}): boolean {
  return !params.storageLoading
    && !params.replyInFlight
    && params.currentTurnStatus === 'failed'
}

function isMetadataRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Single visibility rule for thread messages that must never render as
 * bubbles (hidden internal sends marked `workspaceAssistantHidden`). The
 * renderer and every message-order derivation (e.g. the undelivered marker)
 * share this predicate so "visible message" has exactly one meaning.
 */
export function isWorkspaceAssistantHiddenThreadMessageMetadata(metadata: unknown): boolean {
  if (!isMetadataRecord(metadata)) return false
  const custom = metadata.custom
  if (!isMetadataRecord(custom)) return false
  return custom.workspaceAssistantHidden === true
}

/**
 * Resolve the exact user message that sourced a failed/interrupted Turn.
 * `sourceId` is the persisted UIMessage id, so message order is never used as
 * an ownership heuristic.
 */
export function resolveWorkspaceAssistantUndeliveredUserMessage(params: {
  readonly messages: readonly UIMessage[]
  readonly showDeliveryFailureNotice: boolean
  readonly currentTurnSourceKind: AgentTurnSourceKind | null
  readonly currentTurnSourceId: string | null
}): UIMessage | null {
  if (!params.showDeliveryFailureNotice) return null
  if (params.currentTurnSourceKind !== 'user') return null
  if (!params.currentTurnSourceId) return null
  const message = params.messages.find(
    (candidate) => candidate.id === params.currentTurnSourceId,
  )
  return message?.role === 'user'
    && !isWorkspaceAssistantHiddenThreadMessageMetadata(message.metadata)
    ? message
    : null
}

/** Send input rebuilt from an undelivered user message for a one-click resend. */
export interface WorkspaceAssistantResendDraft {
  readonly text: string
  readonly attachments: readonly ProjectAssistantTextAttachment[]
  readonly mediaAttachments: readonly ProjectAssistantMediaAttachment[]
}

/**
 * Rebuilds the send input from the undelivered user message itself — the same
 * message object the thread renders — so the resend duplicates no draft state.
 * Returns null when the message carries nothing resendable or its attachment
 * metadata fails strict parsing: a resend must be faithful, so a message that
 * cannot be fully reconstructed gets no resend affordance instead of a
 * silently degraded retry. Media attachments keep their original signed
 * `attachmentToken`; the server-side resolve authority re-validates it on the
 * new send and rejects legacy token-less refs explicitly.
 */
export function resolveWorkspaceAssistantResendDraft(
  message: UIMessage | null,
): WorkspaceAssistantResendDraft | null {
  if (!message) return null
  const text = message.parts
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n\n')
    .trim()
  let attachments: ProjectAssistantTextAttachment[]
  let mediaAttachments: ProjectAssistantMediaAttachment[]
  try {
    attachments = readProjectAssistantTextAttachmentsFromMessage(message)
    mediaAttachments = readProjectAssistantMediaAttachmentsFromMessage(message)
  } catch {
    return null
  }
  if (!text && attachments.length === 0 && mediaAttachments.length === 0) return null
  return { text, attachments, mediaAttachments }
}

/**
 * Structured facts behind one assistant failure, recovered from either a
 * persisted run record or a raw API/transport error payload.
 */
export interface WorkspaceAssistantFailureFacts {
  readonly code: string | null
  readonly message: string | null
  readonly requestId: string | null
}

function readJsonPayload(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function readDomainCode(details: Record<string, unknown> | null): string | null {
  const code = details?.code
  return typeof code === 'string' && code.trim() ? code.trim() : null
}

const BARE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{3,}$/

/**
 * Recovers `{code, message, requestId}` from a send/control failure. The API
 * error body is the primary source; plain transport strings fall back to their
 * leading `SCREAMING_CASE` token so the caller can still localize by code.
 * Substring sniffing for individual codes is deliberately not reintroduced —
 * presentation is decided from the recovered code alone.
 */
export function parseWorkspaceAssistantFailureText(
  text: string | null | undefined,
): WorkspaceAssistantFailureFacts {
  const trimmed = text?.trim()
  if (!trimmed) return { code: null, message: null, requestId: null }

  const payload = readJsonPayload(trimmed)
  if (payload !== null) {
    const parsed = parseApiErrorPayload(payload)
    return {
      // The domain code in `details` is more specific than the transport-level
      // code, so it wins when the route attached one.
      code: readDomainCode(parsed.details) ?? parsed.code,
      message: parsed.message,
      requestId: parsed.requestId,
    }
  }

  const [token] = trimmed.split(/[\s:]/, 1)
  return {
    code: token && BARE_CODE_PATTERN.test(token) ? token : null,
    message: trimmed,
    requestId: null,
  }
}

export interface WorkspaceAssistantFailureView {
  readonly tone: 'danger' | 'info'
  readonly headline: string
  readonly technical: string | null
}

/**
 * Single decision point for how any assistant failure is presented. The
 * headline is the localized text of the canonical error code — the same
 * catalogue the rest of the app renders — and never a bespoke sentence
 * written for this panel. The technical line always carries the code, the
 * requestId and the server's own message so a report can be acted on.
 */
export function resolveWorkspaceAssistantFailureView(params: {
  readonly facts: WorkspaceAssistantFailureFacts
  readonly localizeCode: (code: string) => string | null
  readonly unknownFallback: string
}): WorkspaceAssistantFailureView {
  const { facts } = params
  const localized = facts.code ? params.localizeCode(facts.code)?.trim() || null : null
  const message = facts.message?.trim() || null
  const headline = localized ?? message ?? params.unknownFallback

  const technicalParts = [
    facts.code,
    facts.requestId ? `requestId ${facts.requestId}` : null,
    message && message !== headline ? message : null,
  ].filter((part): part is string => Boolean(part))

  return {
    tone: 'danger',
    headline,
    technical: technicalParts.length > 0 ? technicalParts.join(' · ') : null,
  }
}

export type WorkspaceAssistantSubagentEventGlyph =
  | 'alert'
  | 'check'
  | 'globe'
  | 'loader'
  | 'none'
  | 'tool'

export function resolveWorkspaceAssistantSubagentEventGlyph(params: {
  readonly part: ProjectAgentSubagentEventPartData
  readonly subagentStatus: ProjectAgentSubagentStatus
  readonly isLast: boolean
}): WorkspaceAssistantSubagentEventGlyph {
  const event = params.part.event
  if (
    event.kind === 'tool_failed'
    || event.kind === 'submission_rejected'
    || (event.kind === 'research_completed' && event.status !== 'completed')
  ) {
    return 'alert'
  }

  const isOpen = event.kind === 'tool_called'
    || event.kind === 'research_started'
    || event.kind === 'submission_started'
    || (event.kind === 'generation' && event.status === 'running')
    || (event.kind === 'reasoning' && event.status === 'running')
  if (isOpen && params.isLast) {
    if (params.subagentStatus === 'running') return 'loader'
    if (params.subagentStatus === 'failed' || params.subagentStatus === 'cancelled') {
      return 'alert'
    }
  }

  if (event.kind === 'research_started' || event.kind === 'research_completed') {
    return 'globe'
  }
  if (event.kind === 'submission_accepted') return 'check'
  if (event.kind === 'tool_called' || event.kind === 'tool_completed') {
    return 'tool'
  }
  return 'none'
}
