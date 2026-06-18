import { NextRequest, NextResponse } from 'next/server'
import { safeValidateUIMessages, type UIMessage } from 'ai'
import type { Prisma } from '@prisma/client'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAuth } from '@/lib/api-auth'
import { getProjectModelConfig } from '@/lib/config-service'
import { createProjectAgentChatResponse } from '@/lib/project-agent'
import type { ProjectAgentResolvedControl } from '@/lib/project-agent/runtime'
import { normalizeProjectAgentLocale } from '@/lib/project-agent/locale'
import { compressMessages, shouldCompressMessages } from '@/lib/project-agent/message-compression'
import { resolveProjectAgentLanguageModel } from '@/lib/project-agent/model'
import {
  clearProjectAssistantThread,
  loadProjectAssistantThread,
  saveProjectAssistantThread,
} from '@/lib/project-agent/persistence'
import { writeWorkspaceAssistantThreadLog } from '@/lib/project-agent/thread-log'
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
import { resolveEditFirstChoiceContinuation } from '@/lib/project-agent/edit-first-choice-continuation'
import { parseAssistantPermissionMode } from '@/lib/project-agent/permission-mode'
import { approveProjectEditScriptAssets } from '@/lib/edit-script/service'
import {
  createProjectAgentRun,
  getProjectAgentRun,
  safelyUpdateProjectAgentRunStatus,
  supersedePendingRunsInScope,
  type ProjectAgentRunRecord,
} from '@/lib/project-agent/runs'

type RequestBody = {
  messages?: unknown
  context?: unknown
  episodeId?: string | null
  locale?: string | null
  assistantPermissionMode?: unknown
  control?: unknown
}

function mapProjectAgentError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (error instanceof Error) {
    if (error.message === 'PROJECT_AGENT_MODEL_NOT_CONFIGURED') {
      return new ApiError('MISSING_CONFIG', {
        code: error.message,
        message: 'analysisModel is required before using project assistant',
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
    ) {
      return new ApiError('INVALID_PARAMS', {
        code: error.message,
        message: error.message,
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

function readLocaleFromBody(body: RequestBody): 'zh' | 'en' {
  if (body.context && typeof body.context === 'object') {
    return normalizeProjectAgentLocale((body.context as Record<string, unknown>).locale)
  }
  return normalizeProjectAgentLocale(body.locale)
}

async function compressThreadMessagesIfNeeded(params: {
  userId: string
  projectId: string
  locale: 'zh' | 'en'
  messages: unknown
}) {
  const validation = await safeValidateUIMessages({ messages: params.messages })
  if (!validation.success) {
    throw new Error('PROJECT_AGENT_INVALID_MESSAGES')
  }
  const messages = ensureUniqueUIMessages(validation.data)
  if (!shouldCompressMessages(messages)) {
    return messages
  }

  const projectConfig = await getProjectModelConfig(params.projectId, params.userId)
  const analysisModelKey = projectConfig.analysisModel?.trim() || ''
  if (!analysisModelKey) {
    throw new Error('PROJECT_AGENT_MODEL_NOT_CONFIGURED')
  }

  const resolved = await resolveProjectAgentLanguageModel({
    userId: params.userId,
    analysisModelKey,
  })

  return await compressMessages({
    messages,
    locale: params.locale,
    model: resolved.languageModel,
  })
}

async function validateThreadMessages(messages: unknown) {
  const validation = await safeValidateUIMessages({ messages })
  if (!validation.success) {
    throw new Error('PROJECT_AGENT_INVALID_MESSAGES')
  }
  return ensureUniqueUIMessages(validation.data)
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
    }
    if (controlAction.choiceType === 'asset_review' && readNonEmptyString(controlAction.output.decision) === 'approve') {
      if (!scope.episodeId) {
        throw new Error('PROJECT_AGENT_ASSET_REVIEW_EPISODE_ID_REQUIRED')
      }
      await approveProjectEditScriptAssets({
        projectId: scope.projectId,
        userId: scope.userId,
        episodeId: scope.episodeId,
      })
    }
    const continuation = resolveEditFirstChoiceContinuation({
      choiceType: controlAction.choiceType,
      toolCallId: controlAction.toolCallId,
      output: controlAction.output,
      latestUserText: readLatestVisibleUserText(params.messages),
    })
    if (!continuation) {
      throw new Error('PROJECT_AGENT_CHOICE_RESPONSE_INVALID')
    }
    return {
      kind: 'choice',
      interruptionId: controlAction.interruptionId,
      choiceType: controlAction.choiceType,
      toolCallId: controlAction.toolCallId,
      cardId: readNonEmptyString(controlAction.output.cardId),
      continuation,
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
  request: NextRequest
  controlAction: ProjectAgentControlAction | null
  scope: ProjectAgentControlScope
}): Promise<ProjectAgentRunRecord> {
  if (!params.controlAction) {
    return await createProjectAgentRun({
      ...params.scope,
      requestId: getRequestId(params.request) ?? crypto.randomUUID(),
      controlKind: 'user_turn',
    })
  }
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
  await safelyUpdateProjectAgentRunStatus({
    runId: run.id,
    status: 'running',
    stopReason: params.controlAction.type,
  })
  return run
}

export const PUT = apiHandler(async (
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
    const locale = readLocaleFromBody(body)
    const messages = await compressThreadMessagesIfNeeded({
      userId: authResult.session.user.id,
      projectId,
      locale,
      messages: body.messages ?? [],
    })
    const thread = await saveProjectAssistantThread({
      projectId,
      userId: authResult.session.user.id,
      episodeId: readEpisodeIdFromBody(body),
      assistantId: 'workspace-command',
      messages,
    })
    await writeWorkspaceAssistantThreadLog(thread)
    return NextResponse.json({ thread })
  } catch (error) {
    throw mapProjectAgentError(error)
  }
})

export const DELETE = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult

  try {
    await clearProjectAssistantThread({
      projectId,
      userId: authResult.session.user.id,
      episodeId: readEpisodeIdFromQuery(request),
      assistantId: 'workspace-command',
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
    const locale = readLocaleFromBody(body)
    const assistantPermissionMode = parseAssistantPermissionMode(body.assistantPermissionMode)
    const controlAction = parseProjectAgentControlAction(body.control)
    if (controlAction && request.headers.get('x-project-agent-run-control') !== '1') {
      throw new Error('PROJECT_AGENT_CONTROL_ENDPOINT_REQUIRED')
    }
    const requestMessages = await validateThreadMessages(body.messages)
    const userId = authResult.session.user.id
    const episodeId = readEpisodeIdFromRequestBody(body)
    const scope = {
      projectId,
      userId,
      episodeId,
      assistantId: 'workspace-command' as const,
    }
    const messages = controlAction?.type === 'approval_response'
      ? requestMessages
      : await compressThreadMessagesIfNeeded({
          userId,
          projectId,
          locale,
          messages: requestMessages,
        })
    const runLock = await acquireProjectAgentRunLock(scope)
    if (!runLock) {
      throw new ApiError('CONFLICT', {
        code: 'PROJECT_AGENT_RUN_ACTIVE',
        message: 'another assistant run is already active for this thread',
      })
    }
    let run: ProjectAgentRunRecord | null = null
    try {
      run = await resolveProjectAgentRunForRequest({
        request,
        controlAction,
        scope,
      })
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
        await safelyUpdateProjectAgentRunStatus({
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
