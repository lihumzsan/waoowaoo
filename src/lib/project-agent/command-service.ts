import type { UIMessage } from 'ai'
import type { Prisma } from '@prisma/client'
import type { NextRequest } from 'next/server'
import { getRequestId } from '@/lib/api-errors'
import { createProjectAgentChatResponse } from './runtime'
import type { ProjectAgentResolvedControl } from './runtime'
import {
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
  readRetryableConsumedProjectAgentApprovalInterruption,
  readRetryableConsumedProjectAgentChoiceInterruption,
  type DeclinedProjectAgentInterruption,
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
    const response = {
      approved: controlAction.approved,
      reason: controlAction.reason,
    } satisfies Prisma.InputJsonObject
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

  await ensureProjectAgentRunSlotAvailable(scope)
  const existingControlRun = controlAction
    ? await resolveProjectAgentRunForControl({ controlAction, scope })
    : null
  const runId = existingControlRun
    && (existingControlRun.status === 'failed' || existingControlRun.status === 'cancelled')
    ? crypto.randomUUID()
    : controlAction?.runId ?? crypto.randomUUID()
  const runLock = await acquireProjectAgentRunLock({
    ...scope,
    runId,
  })
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
