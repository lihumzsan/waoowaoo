import type { UIMessage } from 'ai'
import { parseClientError } from '@/lib/errors/client'
import { isKnownErrorCode } from '@/lib/errors/codes'
import {
  projectErrorForUser,
  type UserErrorAction,
} from '@/lib/errors/projection'
import type { AssistantRuntimeSessionTurnView } from '@/lib/assistant-runtime/view-contract'
import {
  readProjectAssistantTextAttachmentsFromMessage,
  type ProjectAssistantTextAttachment,
} from '@/lib/project-agent/text-attachments'
import {
  readProjectAssistantMediaAttachmentsFromMessage,
  type ProjectAssistantMediaAttachment,
} from '@/lib/project-agent/media-attachments'

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
  readonly currentTurnSourceKind: AssistantRuntimeSessionTurnView['sourceKind'] | null
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

/**
 * A message is undelivered only when its Turn never reached the runtime. Once
 * `startedAt` exists the model may already have produced text or files
 * side effects, so offering "resend" would risk duplicating real work.
 */
export function shouldShowWorkspaceAssistantDeliveryFailure(params: {
  readonly storageLoading: boolean
  readonly replyInFlight: boolean
  readonly currentTurnStatus?: string | null
  readonly currentTurnStartedAt?: string | null
}): boolean {
  return !params.storageLoading
    && !params.replyInFlight
    && (params.currentTurnStatus === 'failed' || params.currentTurnStatus === 'interrupted')
    && !params.currentTurnStartedAt
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
  readonly requestId: string | null
  readonly diagnostic: string | null
}

/**
 * Recovers only safe structured facts from a send/control failure. Provider
 * messages and transport text are deliberately excluded from presentation.
 */
export function parseWorkspaceAssistantFailureText(
  text: string | null | undefined,
): WorkspaceAssistantFailureFacts {
  const trimmed = text?.trim()
  if (!trimmed) return { code: null, requestId: null, diagnostic: null }
  const parsed = parseClientError(trimmed)
  return {
    code: parsed.code,
    requestId: parsed.requestId,
    diagnostic: null,
  }
}

export interface WorkspaceAssistantFailureView {
  readonly tone: 'danger' | 'info'
  readonly headline: string
  readonly technical: string | null
  readonly action: UserErrorAction
}

export type WorkspaceAssistantRecoveryAction =
  | 'continue'
  | 'new_conversation'
  | 'resend'
  | null

/**
 * Resolve one recovery action from the persisted Turn facts and the shared
 * error catalogue. A terminal failure may create a continuation Turn only
 * when its canonical action is retry; context exhaustion must start with a
 * fresh native thread instead of sending another message into the full one.
 */
export function resolveWorkspaceAssistantRecoveryAction(params: {
  readonly turnStatus: AssistantRuntimeSessionTurnView['status'] | null
  readonly turnStartedAt: string | null
  readonly cancelReason: string | null
  readonly failureAction: UserErrorAction
  readonly canResend: boolean
}): WorkspaceAssistantRecoveryAction {
  if (params.turnStatus === 'failed' || params.turnStatus === 'interrupted') {
    if (params.failureAction === 'new_conversation') return 'new_conversation'
    if (params.failureAction !== null && params.failureAction !== 'retry') return null
  }
  if (params.turnStatus === 'failed') {
    if (params.failureAction !== 'retry') return null
    return params.turnStartedAt
      ? 'continue'
      : params.canResend ? 'resend' : null
  }
  if (
    params.turnStatus === 'interrupted'
    && params.cancelReason !== 'user_cancelled'
  ) {
    if (params.turnStartedAt) return 'continue'
    return params.canResend ? 'resend' : null
  }
  return null
}

/**
 * Single decision point for how any assistant failure is presented. The
 * headline is the localized text of the canonical error code — the same
 * catalogue the rest of the app renders — and never a bespoke sentence
 * written for this panel. The secondary line carries only a support reference.
 */
export function resolveWorkspaceAssistantFailureView(params: {
  readonly facts: WorkspaceAssistantFailureFacts
  readonly localizeCode: (code: string) => string | null
  readonly formatReference: (id: string) => string
  readonly formatDiagnostic: (message: string) => string
  readonly unknownFallback: string
}): WorkspaceAssistantFailureView {
  const { facts } = params
  const localized = facts.code ? params.localizeCode(facts.code)?.trim() || null : null
  const headline = localized ?? params.unknownFallback

  return {
    tone: 'danger',
    headline,
    technical: [
      facts.diagnostic ? params.formatDiagnostic(facts.diagnostic) : null,
      facts.requestId ? params.formatReference(facts.requestId) : null,
    ].filter((value): value is string => Boolean(value)).join('\n') || null,
    action: facts.code && isKnownErrorCode(facts.code)
      ? projectErrorForUser(facts.code, facts.requestId).action
      : null,
  }
}
