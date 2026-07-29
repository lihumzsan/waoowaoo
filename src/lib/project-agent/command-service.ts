import type { UIMessage } from 'ai'
import type { Prisma } from '@prisma/client'
import type { NextRequest } from 'next/server'
import { getRequestId } from '@/lib/api-errors'
import { createScopedLogger } from '@/lib/logging/core'
import { createProjectAgentChatResponse } from './runtime'
import type { ProjectAgentResolvedControl } from './runtime'
import {
  acquireOrAdoptProjectAgentRunLockForControl,
  acquireProjectAgentRunLock,
  safelyReleaseProjectAgentRunLock,
} from './run-lock'
import { startProjectAgentRunHeartbeat } from './run-heartbeat'
import {
  createProjectAgentControlVisibleUserMessageId,
  type ProjectAgentControlAction,
} from './control'
import {
  consumeProjectAgentApprovalInterruption,
  consumeProjectAgentChoiceInterruption,
  getProjectAgentInterruptionForControl,
  readRetryableConsumedProjectAgentApprovalInterruption,
  readRetryableConsumedProjectAgentChoiceInterruption,
  type DeclinedProjectAgentInterruption,
  type ProjectAgentInterruptionStatus,
} from './interruptions'
import {
  createProjectAgentConsumedControlRetryRun,
  createProjectAgentUserTurnRun,
  ensureProjectAgentRunSlotAvailable,
  getProjectAgentRun,
  settleProjectAgentRunFailureWithMessage,
  type ProjectAgentRunRecord,
} from './runs'
import { createProjectAgentRunFence } from './run-fence'

const commandLogger = createScopedLogger({
  module: 'project-agent.command',
})

type ApprovalControlAction = Extract<ProjectAgentControlAction, { type: 'approval_response' }>
type ChoiceControlAction = Extract<ProjectAgentControlAction, { type: 'choice_response' }>

export type ProjectAgentCommand =
  | {
      kind: 'user_turn'
      message: UIMessage
    }
  | {
      kind: 'approval_response'
      action: ApprovalControlAction
      visibleUserText: string | null
    }
  | {
      kind: 'choice_response'
      action: ChoiceControlAction
      visibleUserText: string | null
    }

export interface ProjectAgentCommandScope {
  projectId: string
  userId: string
  episodeId: string | null
  assistantId: 'workspace-command'
}

export interface ExecuteProjectAgentCommandInput {
  request: NextRequest
  scope: ProjectAgentCommandScope
  context: unknown
  locale: string | null
  command: ProjectAgentCommand
}

interface ResolvedProjectAgentControlCommand {
  control: ProjectAgentResolvedControl
  retryInterruptionId: string | null
}

function readControlAction(command: ProjectAgentCommand): ProjectAgentControlAction | null {
  switch (command.kind) {
    case 'user_turn':
      return null
    case 'approval_response':
    case 'choice_response':
      return command.action
  }
}

function readVisibleUserText(command: ProjectAgentCommand): string | null {
  switch (command.kind) {
    case 'user_turn':
      return null
    case 'approval_response':
    case 'choice_response':
      return command.visibleUserText
  }
}

/**
 * Observability-only size of the user-supplied input for this command.
 * Content itself is never logged.
 */
function countCommandInputChars(command: ProjectAgentCommand): number {
  switch (command.kind) {
    case 'user_turn':
      return command.message.parts.reduce((total, part) => (
        part.type === 'text' ? total + part.text.length : total
      ), 0)
    case 'approval_response':
    case 'choice_response':
      return command.visibleUserText?.length ?? 0
  }
}

function buildControlVisibleUserMessage(params: {
  controlAction: ProjectAgentControlAction
  text: string
}): UIMessage {
  return {
    id: createProjectAgentControlVisibleUserMessageId(params.controlAction),
    role: 'user',
    parts: [{
      type: 'text',
      text: params.text,
    }],
  }
}

async function resolveProjectAgentRunForControl(params: {
  controlAction: ProjectAgentControlAction
  scope: ProjectAgentCommandScope
}): Promise<ProjectAgentRunRecord> {
  const run = await getProjectAgentRun({
    ...params.scope,
    runId: params.controlAction.runId,
  })
  if (!run) throw new Error('PROJECT_AGENT_RUN_NOT_FOUND')
  return run
}

function buildApprovalControlResponse(action: ApprovalControlAction): Prisma.InputJsonObject {
  return {
    approved: action.approved,
    reason: action.reason,
  } satisfies Prisma.InputJsonObject
}

export const PROJECT_AGENT_CONTROL_ALREADY_RESOLVED_CODE = 'PROJECT_AGENT_CONTROL_ALREADY_RESOLVED'

type ProjectAgentControlAdmission =
  | { kind: 'proceed' }
  | { kind: 'already_resolved'; interruptionStatus: Exclude<ProjectAgentInterruptionStatus, 'pending'> }

/**
 * Admission for a control command, decided from the durable target facts
 * BEFORE any Run slot or Redis lock decision. A card whose interruption was
 * already consumed by another path (e.g. a newer user message rejecting the
 * approval, or the same decision in another tab) or superseded is answered
 * with a calm typed response instead of colliding with the currently active
 * run. Only a consumed decision whose identical response is still retryable
 * proceeds into the existing retry path, which keeps its typed fail-closed
 * conflicts (AR-02G).
 */
async function resolveProjectAgentControlAdmission(params: {
  controlAction: ProjectAgentControlAction
  scope: ProjectAgentCommandScope
}): Promise<ProjectAgentControlAdmission> {
  const { controlAction, scope } = params
  const type = controlAction.type === 'approval_response' ? 'approval' : 'choice'
  const interruption = await getProjectAgentInterruptionForControl({
    ...scope,
    runId: controlAction.runId,
    interruptionId: controlAction.interruptionId,
    type,
  })
  if (!interruption) {
    throw new Error(type === 'approval'
      ? 'PROJECT_AGENT_INTERRUPTION_NOT_PENDING'
      : 'PROJECT_AGENT_CHOICE_INTERRUPTION_NOT_PENDING')
  }
  if (interruption.status === 'pending') return { kind: 'proceed' }
  if (interruption.status === 'superseded') {
    return { kind: 'already_resolved', interruptionStatus: 'superseded' }
  }
  const retryable = await (async () => {
    if (controlAction.type === 'approval_response') {
      return await readRetryableConsumedProjectAgentApprovalInterruption({
        ...scope,
        runId: controlAction.runId,
        interruptionId: controlAction.interruptionId,
        response: buildApprovalControlResponse(controlAction),
      })
    }
    try {
      return await readRetryableConsumedProjectAgentChoiceInterruption({
        ...scope,
        runId: controlAction.runId,
        interruptionId: controlAction.interruptionId,
        cardId: controlAction.cardId,
        toolCallId: controlAction.toolCallId,
        response: controlAction.output as Prisma.InputJsonObject,
      })
    } catch (error) {
      // A stale offer cannot be retried; the decision stands as resolved.
      if (error instanceof Error && error.message === 'PROJECT_AGENT_CHOICE_OFFER_STALE') return null
      throw error
    }
  })()
  if (retryable) return { kind: 'proceed' }
  return { kind: 'already_resolved', interruptionStatus: 'consumed' }
}

function createProjectAgentControlAlreadyResolvedResponse(params: {
  controlAction: ProjectAgentControlAction
  run: ProjectAgentRunRecord
  interruptionStatus: Exclude<ProjectAgentInterruptionStatus, 'pending'>
}): Response {
  return Response.json({
    code: PROJECT_AGENT_CONTROL_ALREADY_RESOLVED_CODE,
    runId: params.controlAction.runId,
    runStatus: params.run.status,
    interruptionId: params.controlAction.interruptionId,
    interruptionStatus: params.interruptionStatus,
  }, { status: 200 })
}

async function resolveProjectAgentControl(params: {
  request: NextRequest
  controlAction: ProjectAgentControlAction | null
  scope: ProjectAgentCommandScope
  userMessage: UIMessage | null
  declinedInterruptions: readonly DeclinedProjectAgentInterruption[]
  visibleUserMessages: UIMessage[]
  operationSignal: AbortSignal | null
  locale: string | null
}): Promise<ResolvedProjectAgentControlCommand> {
  const { controlAction, scope } = params

  if (!controlAction) {
    if (!params.userMessage) throw new Error('PROJECT_AGENT_INVALID_MESSAGES')
    return {
      control: {
        kind: 'user_turn',
        message: params.userMessage,
        declinedInterruptions: [...params.declinedInterruptions],
      },
      retryInterruptionId: null,
    }
  }

  if (controlAction.type === 'approval_response') {
    const response = buildApprovalControlResponse(controlAction)
    const consumed = await consumeProjectAgentApprovalInterruption({
      ...scope,
      runId: controlAction.runId,
      interruptionId: controlAction.interruptionId,
      response,
      visibleMessages: params.visibleUserMessages,
    })
    const interruption = consumed ?? await readRetryableConsumedProjectAgentApprovalInterruption({
      ...scope,
      runId: controlAction.runId,
      interruptionId: controlAction.interruptionId,
      response,
      visibleMessages: params.visibleUserMessages,
    })
    if (!interruption) throw new Error('PROJECT_AGENT_INTERRUPTION_NOT_PENDING')
    return {
      control: {
        kind: 'approval',
        interruption,
        approved: controlAction.approved,
        reason: controlAction.reason,
      },
      retryInterruptionId: consumed ? null : interruption.id,
    }
  }

  if (!params.operationSignal) throw new Error('PROJECT_AGENT_CHOICE_OPERATION_SIGNAL_REQUIRED')
  const choiceParams = {
    ...scope,
    request: params.request,
    runId: controlAction.runId,
    interruptionId: controlAction.interruptionId,
    cardId: controlAction.cardId,
    toolCallId: controlAction.toolCallId,
    response: controlAction.output as Prisma.InputJsonObject,
    operationSignal: params.operationSignal,
    locale: params.locale,
    visibleMessages: params.visibleUserMessages,
  }
  const consumed = await consumeProjectAgentChoiceInterruption(choiceParams)
  const consumedChoice = consumed ?? await readRetryableConsumedProjectAgentChoiceInterruption(choiceParams)
  if (!consumedChoice) throw new Error('PROJECT_AGENT_CHOICE_INTERRUPTION_NOT_PENDING')
  return {
    control: {
      kind: 'choice',
      interruptionId: consumedChoice.id,
      toolCallId: consumedChoice.offer.card.toolCallId,
      cardId: consumedChoice.offer.card.cardId,
      appliedOperationId: consumedChoice.appliedOperationId,
      decision: consumedChoice.parsedResponse,
    },
    retryInterruptionId: consumed ? null : consumedChoice.id,
  }
}

/**
 * The unique HTTP command orchestration entry for the workspace Assistant.
 * Routes adapt transport only; lifecycle facts remain owned by Run,
 * interruption, runtime, Operation, Billing and Task Terminal authorities.
 */
export async function executeProjectAgentCommand(
  input: ExecuteProjectAgentCommandInput,
): Promise<Response> {
  const { request, scope, command } = input
  const controlAction = readControlAction(command)
  const requestId = getRequestId(request) ?? crypto.randomUUID()

  // Control commands resolve their durable target FIRST: an already-resolved
  // interruption must never depend on — or collide with — whichever run
  // currently owns the scope slot. Only a still-actionable target competes for
  // the Run slot, and it may exclude (and, for the lock, adopt) its own run.
  const existingControlRun = controlAction
    ? await resolveProjectAgentRunForControl({ controlAction, scope })
    : null
  if (controlAction && existingControlRun) {
    const admission = await resolveProjectAgentControlAdmission({
      controlAction,
      scope,
    })
    if (admission.kind === 'already_resolved') {
      commandLogger.info({
        action: 'assistant.control.already-resolved',
        message: 'Project agent control target was already resolved; returning calm response',
        requestId,
        runId: controlAction.runId,
        projectId: scope.projectId,
        userId: scope.userId,
        details: {
          command: command.kind,
          interruptionId: controlAction.interruptionId,
          interruptionStatus: admission.interruptionStatus,
          runStatus: existingControlRun.status,
        },
      })
      return createProjectAgentControlAlreadyResolvedResponse({
        controlAction,
        run: existingControlRun,
        interruptionStatus: admission.interruptionStatus,
      })
    }
  }
  await ensureProjectAgentRunSlotAvailable(controlAction
    ? { ...scope, excludeRunId: controlAction.runId }
    : scope)
  const runId = existingControlRun
    && (existingControlRun.status === 'failed' || existingControlRun.status === 'cancelled')
    ? crypto.randomUUID()
    : controlAction?.runId ?? crypto.randomUUID()
  const runLock = controlAction
    ? await acquireOrAdoptProjectAgentRunLockForControl({ ...scope, runId })
    : await acquireProjectAgentRunLock({ ...scope, runId })
  if (!runLock) throw new Error('PROJECT_AGENT_RUN_ACTIVE')

  let run: ProjectAgentRunRecord | null = null
  let declinedInterruptions: DeclinedProjectAgentInterruption[] = []
  let controlTransitioned = false
  try {
    const visibleUserText = readVisibleUserText(command)
    const visibleUserMessages = controlAction && visibleUserText
      ? [buildControlVisibleUserMessage({ controlAction, text: visibleUserText })]
      : []
    const userMessage = command.kind === 'user_turn' ? command.message : null

    if (controlAction) {
      run = existingControlRun
      if (!run) throw new Error('PROJECT_AGENT_RUN_NOT_FOUND')
    } else {
      if (!userMessage) throw new Error('PROJECT_AGENT_INVALID_MESSAGES')
      const created = await createProjectAgentUserTurnRun({
        ...scope,
        runId,
        requestId,
        message: userMessage,
      })
      run = created.run
      declinedInterruptions = created.declinedInterruptions
    }

    const choiceOwnershipController = controlAction?.type === 'choice_response'
      ? new AbortController()
      : null
    const choiceHeartbeat = choiceOwnershipController
      ? startProjectAgentRunHeartbeat({
          runId: run.id,
          runLock,
          onOwnershipLost: (error) => {
            if (!choiceOwnershipController.signal.aborted) choiceOwnershipController.abort(error)
          },
        })
      : null
    const resolvedControl = await (async () => {
      try {
        return await resolveProjectAgentControl({
          request,
          controlAction,
          scope,
          userMessage,
          declinedInterruptions,
          visibleUserMessages,
          operationSignal: choiceOwnershipController?.signal ?? null,
          locale: input.locale,
        })
      } finally {
        await choiceHeartbeat?.stop()
      }
    })()
    if (choiceOwnershipController?.signal.aborted) {
      throw choiceOwnershipController.signal.reason
    }

    const control = resolvedControl.control
    if (controlAction) {
      if (resolvedControl.retryInterruptionId) {
        run = await createProjectAgentConsumedControlRetryRun({
          ...scope,
          interruptionId: resolvedControl.retryInterruptionId,
          requestId,
          controlKind: controlAction.type,
          runId: runLock.runId === controlAction.runId ? crypto.randomUUID() : runLock.runId,
        })
      } else {
        const refreshedRun = await getProjectAgentRun({ ...scope, runId: run.id })
        if (!refreshedRun) throw new Error('PROJECT_AGENT_RUN_NOT_FOUND')
        run = refreshedRun
      }
    }
    controlTransitioned = true
    commandLogger.info({
      action: 'assistant.turn.started',
      message: 'Project agent command accepted; runtime invocation starting',
      requestId,
      runId: run.id,
      projectId: scope.projectId,
      userId: scope.userId,
      details: {
        command: command.kind,
        episodeId: scope.episodeId,
        scopeRef: run.scopeRef,
        inputChars: countCommandInputChars(command),
        retriedInterruptionId: resolvedControl.retryInterruptionId,
      },
    })
    return await createProjectAgentChatResponse({
      request,
      userId: scope.userId,
      projectId: scope.projectId,
      context: input.context,
      run,
      control,
      runLock,
    })
  } catch (error) {
    commandLogger.error({
      action: 'assistant.turn.failed',
      message: 'Project agent command failed before streaming started',
      requestId,
      ...(run ? { runId: run.id } : {}),
      projectId: scope.projectId,
      userId: scope.userId,
      details: {
        command: command.kind,
        episodeId: scope.episodeId,
        controlTransitioned,
        error: error instanceof Error ? error.message : String(error),
      },
    })
    if (run && controlTransitioned) {
      const currentRun = await getProjectAgentRun({ ...scope, runId: run.id })
      if (currentRun?.status === 'running') {
        await settleProjectAgentRunFailureWithMessage({
          runFence: createProjectAgentRunFence(currentRun),
          controlKind: controlAction?.type ?? currentRun.controlKind,
          requestId,
          status: 'failed',
          stopReason: 'control_resolution_failed',
          errorCode: 'PROJECT_AGENT_CONTROL_FAILED',
          errorMessage: error instanceof Error ? error.message : String(error),
        })
      }
    }
    await safelyReleaseProjectAgentRunLock(runLock)
    throw error
  }
}
