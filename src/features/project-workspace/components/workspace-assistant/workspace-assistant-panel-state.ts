import { parseApiErrorPayload } from '@/lib/api-error-payload'
import { isWorkspaceAssistantStaleControlErrorText } from './workspace-assistant-runtime-state'
import type { ProjectAgentRunPartData } from '@/lib/project-agent/types'
import type { ProjectAgentSessionActivity } from '@/lib/project-agent/session-state'
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

export function shouldShowWorkspaceAssistantExternalTaskRunCard(params: {
  storageLoading: boolean
  operationId: string | null | undefined
}): boolean {
  return !params.storageLoading && Boolean(params.operationId)
}

export function resolveWorkspaceAssistantExternalTaskOperationId(
  currentActivity: ProjectAgentSessionActivity | null,
): string | null {
  if (currentActivity?.type !== 'waiting_task') return null
  if (currentActivity.status !== 'running' && currentActivity.status !== 'waiting') return null
  return currentActivity.operationId ?? currentActivity.sourceOperationId
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
  currentRunStatus?: ProjectAgentRunPartData['status'] | null
}): boolean {
  return !params.storageLoading
    && !params.replyInFlight
    && params.currentRunStatus === 'failed'
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
    tone: facts.code && isWorkspaceAssistantStaleControlErrorText(facts.code) ? 'info' : 'danger',
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
