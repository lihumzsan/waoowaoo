import { NextRequest, NextResponse } from 'next/server'
import { safeValidateUIMessages, type UIMessage } from 'ai'
import type { Prisma } from '@prisma/client'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuth } from '@/lib/api-auth'
import { createProjectAgentChatResponse } from '@/lib/project-agent'
import type { ProjectAgentResolvedControl } from '@/lib/project-agent/runtime'
import {
  appendProjectAssistantThreadMessages,
  clearProjectAssistantThread,
  loadProjectAssistantThread,
} from '@/lib/project-agent/persistence'
import { ensureUniqueUIMessages } from '@/lib/project-agent/ui-message-validation'
import {
  acquireProjectAgentRunLock,
  safelyReleaseProjectAgentRunLock,
} from '@/lib/project-agent/run-lock'
import {
  parseProjectAgentControlAction,
  type ProjectAgentControlAction,
} from '@/lib/project-agent/control'
import {
  consumeProjectAgentApprovalInterruption,
  consumeProjectAgentChoiceInterruption,
  declinePendingProjectAgentInterruptionsForUserTurn,
} from '@/lib/project-agent/interruptions'
import { consumeProjectAgentWaitFollowUp } from '@/lib/project-agent/waits'
import {
  appendProjectAgentEvents,
  getCurrentProjectAgentActivity,
} from '@/lib/project-agent/event'
import {
  applyEditFirstChoiceResultSideEffects,
  buildEditFirstChoiceResult,
} from '@/lib/project-agent/edit-first-choice-result'
import { parseAssistantPermissionMode } from '@/lib/project-agent/permission-mode'
import { readProjectAssistantTextAttachmentsFromMessage } from '@/lib/project-agent/text-attachments'
import {
  createProjectAgentRun,
  ensureProjectAgentRunSlotAvailable,
  getProjectAgentRun,
  listBlockingProjectAgentRunsForThreadClear,
  updateProjectAgentRunStatus,
  supersedePendingRunsInScope,
  type ProjectAgentRunRecord,
} from '@/lib/project-agent/runs'

type RequestBody = {
  message?: unknown
  context?: unknown
  episodeId?: string | null
  locale?: string | null
  assistantPermissionMode?: unknown
  control?: unknown
  visibleUserText?: unknown
}

function mapProjectAgentError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (error instanceof Error) {
    if (
      error.message === 'PROJECT_AGENT_MODEL_NOT_CONFIGURED'
      || error.message.startsWith('PROJECT_AGENT_ASSISTANT_MODEL_INVALID:')
    ) {
      return new ApiError('MISSING_CONFIG', {
        code: error.message.startsWith('PROJECT_AGENT_ASSISTANT_MODEL_INVALID:')
          ? 'PROJECT_AGENT_ASSISTANT_MODEL_INVALID'
          : error.message,
        message: 'assistant model is required before using project assistant',
      })
    }
    if (
      error.message === 'PROJECT_AGENT_INVALID_MESSAGES'
      || error.message === 'PROJECT_AGENT_EMPTY_MESSAGES'
      || error.message === 'PROJECT_AGENT_EPISODE_REQUIRED'
      || error.message === 'PROJECT_ASSISTANT_INVALID_THREAD_MESSAGES'
      || error.message === 'PROJECT_AGENT_TOOL_SELECTION_INVALID'
      || error.message === 'PROJECT_AGENT_TOOL_SELECTION_TOO_LARGE'
      || error.message === 'PROJECT_AGENT_MESSAGE_SUMMARY_EMPTY'
      || error.message === 'PROJECT_AGENT_ASSISTANT_PERMISSION_MODE_REQUIRED'
      || error.message === 'PROJECT_AGENT_ASSISTANT_PERMISSION_MODE_INVALID'
      || error.message === 'PROJECT_AGENT_CONTROL_INVALID'
      || error.message === 'PROJECT_AGENT_CONTROL_ENDPOINT_REQUIRED'
      || error.message === 'PROJECT_AGENT_CHOICE_RESPONSE_INVALID'
      || error.message === 'PROJECT_AGENT_MESSAGES_NOT_ACCEPTED'
      || error.message === 'PROJECT_ASSISTANT_TEXT_ATTACHMENTS_INVALID'
      || error.message === 'PROJECT_ASSISTANT_TEXT_ATTACHMENTS_TOO_MANY'
      || error.message === 'PROJECT_ASSISTANT_TEXT_ATTACHMENT_INVALID'
    ) {
      return new ApiError('INVALID_PARAMS', {
        code: error.message,
        message: error.message,
      })
    }
    if (error.message === 'PROJECT_AGENT_RUN_ACTIVE') {
      return new ApiError('CONFLICT', {
        code: error.message,
        message: 'another assistant run is already active for this thread',
      })
    }
  }

  return new ApiError('EXTERNAL_ERROR', {
    code: 'PROJECT_AGENT_RUNTIME_FAILED',
    message: error instanceof Error ? error.message : String(error),
  })
}

function readEpisodeIdFromQuery(request: NextRequest): string | null {
  return request.nextUrl.searchParams.get('episodeId')?.trim() || null
}

function readEpisodeIdFromBody(body: RequestBody): string | null {
  return typeof body.episodeId === 'string' && body.episodeId.trim()
    ? body.episodeId.trim()
    : null
}

function readEpisodeIdFromRequestBody(body: RequestBody): string | null {
  const bodyEpisodeId = readEpisodeIdFromBody(body)
  if (bodyEpisodeId) return bodyEpisodeId
  if (body.context && typeof body.context === 'object' && !Array.isArray(body.context)) {
    const contextEpisodeId = (body.context as Record<string, unknown>).episodeId
    return typeof contextEpisodeId === 'string' && contextEpisodeId.trim()
      ? contextEpisodeId.trim()
      : null
  }
  return null
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

async function validateUserMessage(message: unknown): Promise<UIMessage> {
  const validation = await safeValidateUIMessages({ messages: [message] })
  if (!validation.success) {
    throw new Error('PROJECT_AGENT_INVALID_MESSAGES')
  }
  const [validatedMessage] = ensureUniqueUIMessages(validation.data)
  if (!validatedMessage || validatedMessage.role !== 'user') {
    throw new Error('PROJECT_AGENT_INVALID_MESSAGES')
  }
  readProjectAssistantTextAttachmentsFromMessage(validatedMessage)
  return validatedMessage
}

function isWorkspaceAssistantHiddenMessage(message: UIMessage): boolean {
  const metadata = message.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false
  const custom = (metadata as Record<string, unknown>).custom
  if (!custom || typeof custom !== 'object' || Array.isArray(custom)) return false
  return (custom as Record<string, unknown>).workspaceAssistantHidden === true
}

function readLatestVisibleUserText(messages: readonly UIMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || message.role !== 'user') continue
    if (isWorkspaceAssistantHiddenMessage(message)) continue
    const text = message.parts
      .flatMap((part) => {
        const record = part as { type?: unknown; text?: unknown }
        return record.type === 'text' && typeof record.text === 'string' && record.text.trim()
          ? [record.text]
          : []
      })
      .join('\n')
      .trim()
    if (text) return text
  }
  return ''
}

function readVisibleUserText(body: RequestBody): string | null {
  return readNonEmptyString(body.visibleUserText)
}

function assertNoLegacyMessagesField(body: RequestBody): void {
  if (Object.prototype.hasOwnProperty.call(body, 'messages')) {
    throw new Error('PROJECT_AGENT_MESSAGES_NOT_ACCEPTED')
  }
}

function buildControlVisibleUserMessage(params: {
  controlAction: ProjectAgentControlAction
  text: string
}): UIMessage {
  const idSuffix = params.controlAction.type === 'approval_response'
    ? params.controlAction.interruptionId
    : params.controlAction.type === 'choice_response'
      ? params.controlAction.interruptionId
        ?? readNonEmptyString(params.controlAction.output.cardId)
        ?? params.controlAction.toolCallId
        ?? params.controlAction.choiceType
      : params.controlAction.waitId
  return {
    id: `workspace-control-user:${params.controlAction.type}:${params.controlAction.runId}:${idSuffix}`,
    role: 'user',
    parts: [{
      type: 'text',
      text: params.text,
    }],
  }
}

async function loadAuthoritativeThreadMessages(params: ProjectAgentControlScope): Promise<UIMessage[]> {
  const thread = await loadProjectAssistantThread(params)
  return thread?.messages ?? []
}

function appendUniqueMessages(existing: readonly UIMessage[], appended: readonly UIMessage[]): UIMessage[] {
  const existingIds = new Set(existing.map((message) => message.id))
  return ensureUniqueUIMessages([
    ...existing,
    ...appended.filter((message) => !existingIds.has(message.id)),
  ])
}

async function assertProjectAgentRunSlotAvailable(scope: ProjectAgentControlScope): Promise<void> {
  try {
    await ensureProjectAgentRunSlotAvailable(scope)
  } catch (error) {
    if (error instanceof Error && error.message === 'PROJECT_AGENT_RUN_ACTIVE') {
      throw new ApiError('CONFLICT', {
        code: 'PROJECT_AGENT_RUN_ACTIVE',
        message: 'another assistant run is already active for this thread',
      })
    }
    throw error
  }
}

interface ProjectAgentControlScope {
  projectId: string
  userId: string
  episodeId: string | null
  assistantId: 'workspace-command'
}

/**
 * Resolves the structured control action against the database. Control state
 * lives in interruption/wait rows with one-time consumption semantics — a
 * mismatch is a protocol conflict and fails loudly instead of being guessed
 * from message history.
 */
async function resolveProjectAgentControl(params: {
  controlAction: ProjectAgentControlAction | null
  scope: ProjectAgentControlScope
  messages: UIMessage[]
  run: ProjectAgentRunRecord
}): Promise<ProjectAgentResolvedControl> {
  const { controlAction, scope } = params

  if (!controlAction) {
    await supersedePendingRunsInScope(scope)
    const declinedInterruptions = await declinePendingProjectAgentInterruptionsForUserTurn(scope)
    return {
      kind: 'user_turn',
      declinedInterruptions,
    }
  }

  if (controlAction.type === 'approval_response') {
    const interruption = await consumeProjectAgentApprovalInterruption({
      ...scope,
      runId: controlAction.runId,
      interruptionId: controlAction.interruptionId,
      response: {
        approved: controlAction.approved,
        reason: controlAction.reason,
      },
    })
    if (!interruption) {
      throw new ApiError('CONFLICT', {
        code: 'PROJECT_AGENT_INTERRUPTION_NOT_PENDING',
        message: 'the approval interruption is not pending (already consumed, superseded, or unknown)',
      })
    }
    return {
      kind: 'approval',
      interruption,
      approved: controlAction.approved,
      reason: controlAction.reason,
    }
  }

  if (controlAction.type === 'choice_response') {
    if (controlAction.interruptionId) {
      const consumedChoice = await consumeProjectAgentChoiceInterruption({
        ...scope,
        runId: controlAction.runId,
        interruptionId: controlAction.interruptionId,
        response: controlAction.output as Prisma.InputJsonObject,
      })
      if (!consumedChoice) {
        throw new ApiError('CONFLICT', {
          code: 'PROJECT_AGENT_CHOICE_INTERRUPTION_NOT_PENDING',
          message: 'the choice interruption is not pending (already consumed, superseded, or unknown)',
        })
      }
    } else {
      const choiceActivity = await getCurrentProjectAgentActivity({
        projectId: scope.projectId,
        userId: scope.userId,
        episodeId: scope.episodeId,
        assistantId: scope.assistantId,
        runId: controlAction.runId,
      })
      if (!choiceActivity || choiceActivity.type !== 'awaiting_choice') {
        throw new ApiError('CONFLICT', {
          code: 'PROJECT_AGENT_CHOICE_ACTIVITY_NOT_PENDING',
          message: 'the choice activity is not pending for this control action',
        })
      }
      await appendProjectAgentEvents({
        scope,
        events: [{
          idempotencyKey: `activity-completed:${choiceActivity.activityId}:choice-response`,
          event: {
            kind: 'activity.completed',
            runId: controlAction.runId,
            activityId: choiceActivity.activityId,
          },
        }],
      })
    }
    await applyEditFirstChoiceResultSideEffects({
      choiceType: controlAction.choiceType,
      output: controlAction.output,
      projectId: scope.projectId,
      userId: scope.userId,
      episodeId: scope.episodeId ?? null,
    })
    const choiceResult = buildEditFirstChoiceResult({
      choiceType: controlAction.choiceType,
      toolCallId: controlAction.toolCallId,
      output: controlAction.output,
      latestUserText: readLatestVisibleUserText(params.messages),
    })
    if (!choiceResult) {
      throw new Error('PROJECT_AGENT_CHOICE_RESPONSE_INVALID')
    }
    return {
      kind: 'choice',
      interruptionId: controlAction.interruptionId,
      choiceType: controlAction.choiceType,
      toolCallId: controlAction.toolCallId,
      cardId: readNonEmptyString(controlAction.output.cardId),
      choiceResult,
    }
  }

  const followUp = await consumeProjectAgentWaitFollowUp({
    runId: controlAction.runId,
    waitId: controlAction.waitId,
    claimId: controlAction.claimId,
    projectId: scope.projectId,
    userId: scope.userId,
  })
  if (!followUp) {
    throw new ApiError('CONFLICT', {
      code: 'PROJECT_AGENT_WAIT_FOLLOW_UP_NOT_CLAIMED',
      message: 'the wait follow-up is not claimable (claim mismatch or already followed)',
    })
  }
  return {
    kind: 'task_follow_up',
    followUp,
  }
}

export const runtime = 'nodejs'

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult

  try {
    const thread = await loadProjectAssistantThread({
      projectId,
      userId: authResult.session.user.id,
      episodeId: readEpisodeIdFromQuery(request),
      assistantId: 'workspace-command',
    })
    return NextResponse.json({ thread })
  } catch (error) {
    throw mapProjectAgentError(error)
  }
})

async function resolveProjectAgentRunForRequest(params: {
  controlAction: ProjectAgentControlAction
  scope: ProjectAgentControlScope
}): Promise<ProjectAgentRunRecord> {
  const run = await getProjectAgentRun({
    ...params.scope,
    runId: params.controlAction.runId,
  })
  if (!run) {
    throw new ApiError('CONFLICT', {
      code: 'PROJECT_AGENT_RUN_NOT_FOUND',
      message: 'the agent run is not available for this control action',
    })
  }
  await updateProjectAgentRunStatus({
    runId: run.id,
    status: 'running',
    stopReason: params.controlAction.type,
  })
  return run
}

export const DELETE = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult

  try {
    const scope = {
      projectId,
      userId: authResult.session.user.id,
      episodeId: readEpisodeIdFromQuery(request),
      assistantId: 'workspace-command' as const,
    }
    const blockingRuns = await listBlockingProjectAgentRunsForThreadClear(scope)
    if (blockingRuns.length > 0) {
      throw new ApiError('CONFLICT', {
        code: 'PROJECT_AGENT_THREAD_ACTIVE',
        message: 'assistant thread cannot be cleared while an assistant run is active or waiting',
      })
    }
    await clearProjectAssistantThread({
      ...scope,
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    throw mapProjectAgentError(error)
  }
})

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult

  let body: RequestBody
  try {
    body = (await request.json()) as RequestBody
  } catch {
    throw new ApiError('INVALID_PARAMS', {
      code: 'BODY_PARSE_FAILED',
      field: 'body',
      message: 'request body must be valid JSON',
    })
  }

  try {
    assertNoLegacyMessagesField(body)
    const assistantPermissionMode = parseAssistantPermissionMode(body.assistantPermissionMode)
    const controlAction = parseProjectAgentControlAction(body.control)
    if (controlAction && request.headers.get('x-project-agent-run-control') !== '1') {
      throw new Error('PROJECT_AGENT_CONTROL_ENDPOINT_REQUIRED')
    }
    const userMessage = controlAction ? null : await validateUserMessage(body.message)
    const userId = authResult.session.user.id
    const episodeId = readEpisodeIdFromRequestBody(body)
    const scope = {
      projectId,
      userId,
      episodeId,
      assistantId: 'workspace-command' as const,
    }
    await assertProjectAgentRunSlotAvailable(scope)
    const runId = controlAction?.runId ?? crypto.randomUUID()
    const runLock = await acquireProjectAgentRunLock({
      ...scope,
      runId,
    })
    if (!runLock) {
      throw new ApiError('CONFLICT', {
        code: 'PROJECT_AGENT_RUN_ACTIVE',
        message: 'another assistant run is already active for this thread',
      })
    }
    let run: ProjectAgentRunRecord | null = null
    try {
      const existingMessages = await loadAuthoritativeThreadMessages(scope)
      const visibleUserText = controlAction ? readVisibleUserText(body) : null
      const visibleUserMessages = controlAction && visibleUserText
        ? [buildControlVisibleUserMessage({ controlAction, text: visibleUserText })]
        : []
      const newMessages = userMessage ? [userMessage] : visibleUserMessages
      const messages = appendUniqueMessages(existingMessages, newMessages)
      if (controlAction) {
        run = await resolveProjectAgentRunForRequest({
          controlAction,
          scope,
        })
      } else {
        if (!userMessage) throw new Error('PROJECT_AGENT_INVALID_MESSAGES')
        run = await createProjectAgentRun({
          ...scope,
          runId,
          requestId: getRequestId(request) ?? crypto.randomUUID(),
          controlKind: 'user_turn',
          appendMessages: [userMessage],
        })
      }
      if (visibleUserMessages.length > 0) {
        await appendProjectAssistantThreadMessages({
          ...scope,
          messages: visibleUserMessages,
        })
      }
      const control = await resolveProjectAgentControl({
        controlAction,
        scope,
        messages,
        run,
      })
      return await createProjectAgentChatResponse({
        request,
        userId,
        projectId,
        context: body.context,
        messages,
        assistantPermissionMode,
        run,
        control,
        runLock,
      })
    } catch (error) {
      await safelyReleaseProjectAgentRunLock(runLock)
      if (run) {
        await updateProjectAgentRunStatus({
          runId: run.id,
          status: 'failed',
          stopReason: 'control_resolution_failed',
          errorCode: 'PROJECT_AGENT_CONTROL_FAILED',
          errorMessage: error instanceof Error ? error.message : String(error),
        })
      }
      throw error
    }
  } catch (error) {
    throw mapProjectAgentError(error)
  }
})
