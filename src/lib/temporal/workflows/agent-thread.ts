import {
  ActivityCancellationType,
  ApplicationFailure,
  CancellationScope,
  allHandlersFinished,
  condition,
  defineUpdate,
  proxyActivities,
  setHandler,
  workflowInfo,
} from '@temporalio/workflow'
import {
  AGENT_TURN_SOURCE_KIND,
  type AgentTurnAdmissionReceipt,
  type AgentTurnCommandEnvelope,
  type AgentTurnExecutionResult,
} from '../../agent-turn/contracts'
import type {
  AgentTurnApprovalDecisionReceipt,
  ResolveAgentTurnApprovalCommand,
} from '../../agent-turn/approval'
import type { ResolveAgentTurnChoiceCommand } from '../../agent-turn/choice'
import type {
  AgentThreadClearReceipt,
  AgentTurnCancellationReceipt,
  CancelAgentTurnCommand,
  ClearAgentThreadCommand,
} from '../../agent-turn/lifecycle'
import {
  AGENT_THREAD_UPDATE_NAME,
  type AgentThreadCoordinatorActivities,
  type AgentThreadCoordinatorResult,
  type AgentThreadCoordinatorWorkflowInput,
  type AgentThreadQueuedTurn,
} from '../agent-thread/contracts'

const submitTurn = defineUpdate<AgentTurnAdmissionReceipt, [AgentTurnCommandEnvelope]>(
  AGENT_THREAD_UPDATE_NAME.SUBMIT_TURN,
)

const resolveApproval = defineUpdate<
  AgentTurnApprovalDecisionReceipt,
  [ResolveAgentTurnApprovalCommand]
>(AGENT_THREAD_UPDATE_NAME.RESOLVE_APPROVAL)

const resolveChoice = defineUpdate<AgentTurnAdmissionReceipt, [ResolveAgentTurnChoiceCommand]>(
  AGENT_THREAD_UPDATE_NAME.RESOLVE_CHOICE,
)

const cancelTurn = defineUpdate<AgentTurnCancellationReceipt, [CancelAgentTurnCommand]>(
  AGENT_THREAD_UPDATE_NAME.CANCEL_TURN,
)

const clearThread = defineUpdate<AgentThreadClearReceipt, [ClearAgentThreadCommand]>(
  AGENT_THREAD_UPDATE_NAME.CLEAR_THREAD,
)

const admissionActivities = proxyActivities<
  Pick<AgentThreadCoordinatorActivities, 'admitAgentTurn' | 'recoverAgentThread'>
>({
  startToCloseTimeout: '1 minute',
  retry: {
    initialInterval: '500 milliseconds',
    backoffCoefficient: 2,
    maximumInterval: '15 seconds',
  },
})

const executionActivities = proxyActivities<
  Pick<AgentThreadCoordinatorActivities, 'executeAgentTurn' | 'resumeAgentTurnApproval'>
>({
  startToCloseTimeout: '1 day',
  heartbeatTimeout: '45 seconds',
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: {
    maximumAttempts: 1,
  },
})

const settlementActivities = proxyActivities<
  Pick<AgentThreadCoordinatorActivities, 'settleLostAgentTurn'>
>({
  startToCloseTimeout: '1 minute',
  retry: {
    initialInterval: '500 milliseconds',
    backoffCoefficient: 2,
    maximumInterval: '15 seconds',
  },
})

const interactionActivities = proxyActivities<
  Pick<AgentThreadCoordinatorActivities, 'resolveAgentTurnApproval' | 'resolveAgentTurnChoice'>
>({
  startToCloseTimeout: '1 minute',
  retry: {
    initialInterval: '500 milliseconds',
    backoffCoefficient: 2,
    maximumInterval: '15 seconds',
  },
})

const lifecycleActivities = proxyActivities<
  Pick<AgentThreadCoordinatorActivities, 'cancelAgentTurn' | 'clearAgentThread'>
>({
  startToCloseTimeout: '1 minute',
  retry: {
    initialInterval: '500 milliseconds',
    backoffCoefficient: 2,
    maximumInterval: '15 seconds',
  },
})

function fail(code: string, ...details: unknown[]): never {
  throw ApplicationFailure.nonRetryable(code, code, ...details)
}

function validateEnvelope(envelope: AgentTurnCommandEnvelope): void {
  if (
    !envelope ||
    typeof envelope !== 'object' ||
    !envelope.command ||
    typeof envelope.command !== 'object' ||
    typeof envelope.commandId !== 'string' ||
    !envelope.commandId.trim() ||
    typeof envelope.payloadHash !== 'string' ||
    !envelope.payloadHash.trim() ||
    typeof envelope.command.threadId !== 'string' ||
    !envelope.command.threadId.trim() ||
    typeof envelope.command.sourceId !== 'string' ||
    !envelope.command.sourceId.trim() ||
    (envelope.command.sourceKind !== AGENT_TURN_SOURCE_KIND.USER &&
      envelope.command.sourceKind !== AGENT_TURN_SOURCE_KIND.TASK_FOLLOW_UP &&
      envelope.command.sourceKind !== AGENT_TURN_SOURCE_KIND.CHOICE_RESPONSE)
  ) {
    fail('AGENT_TURN_ENVELOPE_INVALID')
  }
}

function validateApprovalCommand(command: ResolveAgentTurnApprovalCommand): void {
  if (
    !command ||
    typeof command !== 'object' ||
    command.protocol !== 'agent_turn_approval_response_v1' ||
    !command.threadId ||
    command.threadId !== command.threadId.trim() ||
    !command.turnId ||
    command.turnId !== command.turnId.trim() ||
    !command.interactionId ||
    command.interactionId !== command.interactionId.trim() ||
    !command.projectId ||
    command.projectId !== command.projectId.trim() ||
    !command.userId ||
    command.userId !== command.userId.trim() ||
    !command.requestId ||
    command.requestId !== command.requestId.trim() ||
    (command.decision !== 'approve' && command.decision !== 'reject') ||
    (command.reason !== null && (!command.reason || command.reason !== command.reason.trim()))
  ) {
    fail('AGENT_TURN_APPROVAL_COMMAND_INVALID')
  }
}

function validateChoiceCommand(command: ResolveAgentTurnChoiceCommand): void {
  if (
    !command ||
    typeof command !== 'object' ||
    command.protocol !== 'agent_turn_choice_response_v1' ||
    !command.threadId ||
    command.threadId !== command.threadId.trim() ||
    !command.offerId ||
    command.offerId !== command.offerId.trim() ||
    !command.projectId ||
    command.projectId !== command.projectId.trim() ||
    !command.userId ||
    command.userId !== command.userId.trim() ||
    !command.requestId ||
    command.requestId !== command.requestId.trim()
  ) {
    fail('AGENT_TURN_CHOICE_COMMAND_INVALID')
  }
}

function validateCancelCommand(command: CancelAgentTurnCommand): void {
  if (
    !command ||
    typeof command !== 'object' ||
    command.protocol !== 'agent_turn_cancel_v1' ||
    !command.threadId ||
    command.threadId !== command.threadId.trim() ||
    !command.turnId ||
    command.turnId !== command.turnId.trim() ||
    !command.projectId ||
    command.projectId !== command.projectId.trim() ||
    !command.userId ||
    command.userId !== command.userId.trim() ||
    !command.requestId ||
    command.requestId !== command.requestId.trim() ||
    (command.reason !== null && (!command.reason || command.reason !== command.reason.trim()))
  ) {
    fail('AGENT_TURN_CANCEL_COMMAND_INVALID')
  }
}

function validateClearCommand(command: ClearAgentThreadCommand): void {
  if (
    !command ||
    typeof command !== 'object' ||
    command.protocol !== 'agent_thread_clear_v1' ||
    !command.threadId ||
    command.threadId !== command.threadId.trim() ||
    !command.projectId ||
    command.projectId !== command.projectId.trim() ||
    !command.userId ||
    command.userId !== command.userId.trim() ||
    command.assistantId !== 'workspace-command' ||
    !command.requestId ||
    command.requestId !== command.requestId.trim() ||
    (command.episodeId !== null &&
      (!command.episodeId || command.episodeId !== command.episodeId.trim()))
  ) {
    fail('AGENT_THREAD_CLEAR_COMMAND_INVALID')
  }
}

function validateInput(input: AgentThreadCoordinatorWorkflowInput): void {
  if (
    !input ||
    typeof input !== 'object' ||
    !input.workflowId ||
    input.workflowId !== input.workflowId.trim() ||
    !input.threadId ||
    input.threadId !== input.threadId.trim()
  ) {
    fail('AGENT_THREAD_WORKFLOW_INPUT_INVALID')
  }
  if (workflowInfo().workflowId !== input.workflowId) {
    fail('AGENT_THREAD_WORKFLOW_ID_DIVERGED', workflowInfo().workflowId, input.workflowId)
  }
}

function activityErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.slice(0, 2_000)
  }
  return 'Agent Turn Activity stopped before terminal settlement'
}

export async function agentThreadCoordinatorWorkflow(
  input: AgentThreadCoordinatorWorkflowInput,
): Promise<AgentThreadCoordinatorResult> {
  validateInput(input)
  const queued: AgentThreadQueuedTurn[] = []
  const receipts = new Map<string, AgentTurnAdmissionReceipt>()
  let recoveryInFlight = true
  let admissionInFlight = false
  let activeTurnId: string | null = null
  let pendingChoiceTurnId: string | null = null
  let hasAcceptedCommand = false
  let hasHandledCommand = false
  let lastTurn: AgentTurnExecutionResult | null = null
  let approvalResolution: AgentTurnApprovalDecisionReceipt | null = null
  let approvalResolutionInFlight = false
  let lifecycleInFlight = false
  let clearInFlight = false
  let threadCleared = false
  let activeExecutionScope: CancellationScope | null = null
  const readApprovalResolution = (): AgentTurnApprovalDecisionReceipt | null => approvalResolution
  const waitForRecovery = async (): Promise<void> => {
    while (recoveryInFlight) {
      await condition(() => !recoveryInFlight)
    }
  }

  const recordAdmission = (
    envelope: AgentTurnCommandEnvelope,
    receipt: AgentTurnAdmissionReceipt,
    priority = false,
  ): AgentTurnAdmissionReceipt => {
    if (
      receipt.workflowId !== input.workflowId ||
      receipt.threadId !== input.threadId ||
      receipt.commandId !== envelope.commandId ||
      receipt.payloadHash !== envelope.payloadHash
    ) {
      return fail('AGENT_TURN_ADMISSION_RECEIPT_DIVERGED')
    }
    receipts.set(envelope.commandId, receipt)
    hasAcceptedCommand = true
    if (receipt.outcome === 'ignored') {
      if (
        envelope.command.sourceKind !== AGENT_TURN_SOURCE_KIND.TASK_FOLLOW_UP ||
        receipt.turn !== null ||
        receipt.ignoredReason !== 'source_cancelled'
      ) {
        return fail('AGENT_TURN_IGNORED_ADMISSION_DIVERGED')
      }
      return receipt
    }
    if (receipt.ignoredReason !== null) {
      return fail('AGENT_TURN_ACCEPTED_ADMISSION_DIVERGED')
    }
    if (receipt.turn.status === 'queued') {
      const alreadyQueued = queued.find((entry) => entry.turn.id === receipt.turn.id)
      if (alreadyQueued) {
        if (alreadyQueued.payloadHash !== receipt.turn.payloadHash) {
          return fail('AGENT_TURN_RECOVERED_REPLAY_DIVERGED', receipt.turn.id)
        }
        return receipt
      }
      if (activeTurnId === receipt.turn.id) return receipt
      const item = {
        commandId: envelope.commandId,
        payloadHash: envelope.payloadHash,
        turn: receipt.turn,
      }
      if (priority) queued.unshift(item)
      else queued.push(item)
    } else if (receipt.turn.status === 'running') {
      if (activeTurnId !== receipt.turn.id) {
        return fail('AGENT_TURN_RUNNING_REPLAY_DIVERGED', receipt.turn.id)
      }
    } else if (receipt.turn.status === 'waiting_approval') {
      if (lastTurn?.status !== 'waiting_approval' || lastTurn.turnId !== receipt.turn.id) {
        return fail('AGENT_TURN_APPROVAL_REPLAY_DIVERGED', receipt.turn.id)
      }
    } else if (
      receipt.turn.status !== 'completed' &&
      receipt.turn.status !== 'failed' &&
      receipt.turn.status !== 'interrupted' &&
      receipt.turn.status !== 'cancelled'
    ) {
      return fail('AGENT_TURN_ADMISSION_STATE_INVALID', receipt.turn.id, receipt.turn.status)
    }
    return receipt
  }

  const resumePendingApproval = async (): Promise<void> => {
    while (lastTurn?.status === 'waiting_approval') {
      await condition(
        () =>
          approvalResolution !== null || lastTurn?.status !== 'waiting_approval' || threadCleared,
      )
      if (threadCleared || lastTurn?.status !== 'waiting_approval') {
        break
      }
      const resolution = readApprovalResolution()
      if (!resolution) continue
      approvalResolution = null
      const waitingTurnId = lastTurn.turnId
      const resumeOwnerId = [
        input.workflowId,
        waitingTurnId,
        resolution.interactionId,
        resolution.requestId,
      ].join(':')
      activeTurnId = waitingTurnId
      const resumeScope = new CancellationScope()
      activeExecutionScope = resumeScope
      try {
        lastTurn = await resumeScope.run(
          async () =>
            await executionActivities.resumeAgentTurnApproval({
              workflowId: input.workflowId,
              threadId: input.threadId,
              turnId: waitingTurnId,
              interactionId: resolution.interactionId,
              executionOwnerId: resumeOwnerId,
            }),
        )
      } catch (error) {
        if (threadCleared) {
          lastTurn = {
            turnId: resolution.turnId,
            status: 'cancelled',
            stopReason: 'thread_cleared',
            errorCode: null,
          }
        } else {
          lastTurn = await settlementActivities.settleLostAgentTurn({
            workflowId: input.workflowId,
            threadId: input.threadId,
            turnId: resolution.turnId,
            executionOwnerId: resumeOwnerId,
            errorCode: 'AGENT_TURN_APPROVAL_ACTIVITY_LOST',
            errorMessage: activityErrorMessage(error),
          })
        }
      } finally {
        activeExecutionScope = null
        activeTurnId = null
      }
    }
  }

  setHandler(
    submitTurn,
    async (envelope) => {
      validateEnvelope(envelope)
      await waitForRecovery()
      if (threadCleared || clearInFlight) {
        return fail('AGENT_THREAD_CLEARED')
      }
      if (envelope.command.threadId !== input.threadId) {
        return fail('AGENT_THREAD_COMMAND_SCOPE_DIVERGED')
      }
      hasHandledCommand = true
      while (admissionInFlight || approvalResolutionInFlight || lifecycleInFlight) {
        await condition(
          () => !admissionInFlight && !approvalResolutionInFlight && !lifecycleInFlight,
        )
        if (threadCleared || clearInFlight) {
          return fail('AGENT_THREAD_CLEARED')
        }
        const replay = receipts.get(envelope.commandId)
        if (replay) {
          if (replay.payloadHash !== envelope.payloadHash) {
            return fail('AGENT_TURN_COMMAND_REPLAY_DIVERGED')
          }
          return replay
        }
      }
      const replay = receipts.get(envelope.commandId)
      if (replay) {
        if (replay.payloadHash !== envelope.payloadHash) {
          return fail('AGENT_TURN_COMMAND_REPLAY_DIVERGED')
        }
        return replay
      }
      const foreground = envelope.command.sourceKind !== AGENT_TURN_SOURCE_KIND.TASK_FOLLOW_UP
      const canSupersedeApproval =
        lastTurn?.status === 'waiting_approval' &&
        approvalResolution === null &&
        envelope.command.sourceKind === AGENT_TURN_SOURCE_KIND.USER
      if (
        foreground &&
        lastTurn?.status === 'waiting_approval' &&
        (envelope.command.sourceKind !== AGENT_TURN_SOURCE_KIND.USER || approvalResolution !== null)
      ) {
        return fail('AGENT_THREAD_BUSY', lastTurn.turnId)
      }
      if (
        foreground &&
        (activeTurnId !== null ||
          (queued.length > 0 && pendingChoiceTurnId === null && !canSupersedeApproval))
      ) {
        return fail('AGENT_THREAD_BUSY', activeTurnId ?? queued[0]?.turn.id)
      }
      if (queued.length >= 64) {
        return fail('AGENT_THREAD_FOLLOW_UP_QUEUE_EXHAUSTED')
      }
      admissionInFlight = true
      try {
        const receipt = await admissionActivities.admitAgentTurn({
          workflowId: input.workflowId,
          envelope,
        })
        const supersedesChoice =
          pendingChoiceTurnId !== null &&
          envelope.command.sourceKind === AGENT_TURN_SOURCE_KIND.USER
        const supersedesApproval = canSupersedeApproval
        const supersededApprovalTurnId = supersedesApproval ? (lastTurn?.turnId ?? null) : null
        const recorded = recordAdmission(envelope, receipt, supersedesChoice || supersedesApproval)
        if (supersedesChoice) pendingChoiceTurnId = null
        if (supersededApprovalTurnId) {
          lastTurn = {
            turnId: supersededApprovalTurnId,
            status: 'cancelled',
            stopReason: 'superseded_by_user_turn',
            errorCode: null,
          }
        }
        return recorded
      } finally {
        admissionInFlight = false
      }
    },
    {
      validator: validateEnvelope,
      description: 'Atomically admit one canonical Agent Turn for this Thread.',
    },
  )
  setHandler(
    resolveChoice,
    async (command) => {
      validateChoiceCommand(command)
      await waitForRecovery()
      if (threadCleared || clearInFlight) {
        return fail('AGENT_THREAD_CLEARED')
      }
      if (command.threadId !== input.threadId) {
        return fail('AGENT_TURN_CHOICE_SCOPE_DIVERGED')
      }
      hasHandledCommand = true
      while (admissionInFlight) {
        await condition(() => !admissionInFlight)
        if (threadCleared || clearInFlight) {
          return fail('AGENT_THREAD_CLEARED')
        }
      }
      if (activeTurnId !== null || (queued.length > 0 && pendingChoiceTurnId === null)) {
        return fail('AGENT_THREAD_BUSY', activeTurnId ?? queued[0]?.turn.id)
      }
      admissionInFlight = true
      try {
        const prepared = await interactionActivities.resolveAgentTurnChoice({
          workflowId: input.workflowId,
          command,
        })
        const envelope = prepared.envelope
        validateEnvelope(envelope)
        if (
          prepared.resolution.threadId !== input.threadId ||
          prepared.resolution.offerId !== command.offerId ||
          prepared.resolution.userId !== command.userId ||
          prepared.resolution.requestId !== command.requestId ||
          envelope.command.threadId !== input.threadId ||
          envelope.command.sourceKind !== AGENT_TURN_SOURCE_KIND.CHOICE_RESPONSE ||
          envelope.command.sourceId !== command.offerId ||
          envelope.command.requestId !== command.requestId
        ) {
          return fail('AGENT_TURN_CHOICE_RECEIPT_DIVERGED')
        }
        const receipt = await admissionActivities.admitAgentTurn({
          workflowId: input.workflowId,
          envelope,
        })
        const recorded = recordAdmission(envelope, receipt, pendingChoiceTurnId !== null)
        pendingChoiceTurnId = null
        return recorded
      } finally {
        admissionInFlight = false
      }
    },
    {
      validator: validateChoiceCommand,
      description: 'Persist one Choice answer and admit its canonical successor Turn.',
    },
  )
  setHandler(
    cancelTurn,
    async (command) => {
      validateCancelCommand(command)
      await waitForRecovery()
      if (command.threadId !== input.threadId || threadCleared || clearInFlight) {
        return fail('AGENT_TURN_CANCEL_SCOPE_DIVERGED')
      }
      hasHandledCommand = true
      while (lifecycleInFlight || admissionInFlight || approvalResolutionInFlight) {
        await condition(
          () => !lifecycleInFlight && !admissionInFlight && !approvalResolutionInFlight,
        )
      }
      lifecycleInFlight = true
      try {
        const receipt = await lifecycleActivities.cancelAgentTurn({
          workflowId: input.workflowId,
          command,
        })
        if (
          receipt.protocol !== 'agent_turn_cancellation_receipt_v1' ||
          receipt.threadId !== input.threadId ||
          receipt.turnId !== command.turnId ||
          (receipt.episodeId !== null && !receipt.episodeId) ||
          receipt.requestId !== command.requestId ||
          receipt.status !== 'cancelled'
        ) {
          return fail('AGENT_TURN_CANCEL_RECEIPT_DIVERGED')
        }
        hasHandledCommand = true
        const queuedIndex = queued.findIndex((entry) => entry.turn.id === command.turnId)
        const isActive = activeTurnId === command.turnId
        const isWaitingApproval =
          lastTurn?.turnId === command.turnId && lastTurn.status === 'waiting_approval'
        if (queuedIndex >= 0) {
          queued.splice(queuedIndex, 1)
        }
        if (isWaitingApproval) {
          approvalResolution = null
          lastTurn = {
            turnId: command.turnId,
            status: 'cancelled',
            stopReason: receipt.stopReason,
            errorCode: null,
          }
        }
        if (isActive) {
          activeExecutionScope?.cancel()
        }
        return receipt
      } finally {
        lifecycleInFlight = false
      }
    },
    {
      validator: validateCancelCommand,
      description: 'Cancel one queued, running, or approval-waiting Turn.',
    },
  )
  setHandler(
    clearThread,
    async (command) => {
      validateClearCommand(command)
      await waitForRecovery()
      if (command.threadId !== input.threadId || threadCleared) {
        return fail('AGENT_THREAD_CLEAR_SCOPE_DIVERGED')
      }
      hasHandledCommand = true
      if (clearInFlight) {
        return fail('AGENT_THREAD_CLEAR_ALREADY_IN_FLIGHT')
      }
      clearInFlight = true
      try {
        await condition(
          () => !admissionInFlight && !approvalResolutionInFlight && !lifecycleInFlight,
        )
        lifecycleInFlight = true
        try {
          const receipt = await lifecycleActivities.clearAgentThread({
            workflowId: input.workflowId,
            command,
          })
          if (
            receipt.protocol !== 'agent_thread_clear_receipt_v1' ||
            receipt.threadId !== input.threadId ||
            receipt.projectId !== command.projectId ||
            receipt.userId !== command.userId ||
            receipt.requestId !== command.requestId
          ) {
            return fail('AGENT_THREAD_CLEAR_RECEIPT_DIVERGED')
          }
          threadCleared = true
          pendingChoiceTurnId = null
          queued.splice(0, queued.length)
          approvalResolution = null
          if (lastTurn?.status === 'waiting_approval') {
            lastTurn = {
              turnId: lastTurn.turnId,
              status: 'cancelled',
              stopReason: 'thread_cleared',
              errorCode: null,
            }
          }
          activeExecutionScope?.cancel()
          return receipt
        } finally {
          lifecycleInFlight = false
        }
      } finally {
        clearInFlight = false
      }
    },
    {
      validator: validateClearCommand,
      description: 'Archive this exact Thread and invalidate every pending interaction.',
    },
  )
  setHandler(
    resolveApproval,
    async (command) => {
      validateApprovalCommand(command)
      await waitForRecovery()
      if (threadCleared || clearInFlight) {
        return fail('AGENT_THREAD_CLEARED')
      }
      if (command.threadId !== input.threadId) {
        return fail('AGENT_TURN_APPROVAL_SCOPE_DIVERGED')
      }
      hasHandledCommand = true
      while (approvalResolutionInFlight || admissionInFlight || lifecycleInFlight) {
        await condition(
          () => !approvalResolutionInFlight && !admissionInFlight && !lifecycleInFlight,
        )
      }
      approvalResolutionInFlight = true
      try {
        const receipt = await interactionActivities.resolveAgentTurnApproval({
          workflowId: input.workflowId,
          command,
        })
        if (
          receipt.threadId !== input.threadId ||
          receipt.turnId !== command.turnId ||
          receipt.interactionId !== command.interactionId ||
          (receipt.episodeId !== null && !receipt.episodeId) ||
          receipt.requestId !== command.requestId ||
          receipt.decision !== command.decision ||
          typeof receipt.payloadHash !== 'string' ||
          !receipt.payloadHash ||
          typeof receipt.resumeRequired !== 'boolean'
        ) {
          return fail('AGENT_TURN_APPROVAL_RECEIPT_DIVERGED')
        }
        hasHandledCommand = true
        if (receipt.resumeRequired) {
          if (activeTurnId !== null && activeTurnId !== command.turnId) {
            return fail('AGENT_TURN_APPROVAL_ACTIVE_TURN_DIVERGED', activeTurnId, command.turnId)
          }
          if (
            lastTurn !== null &&
            lastTurn.turnId !== command.turnId &&
            lastTurn.status !== 'completed' &&
            lastTurn.status !== 'failed' &&
            lastTurn.status !== 'interrupted' &&
            lastTurn.status !== 'cancelled'
          ) {
            return fail('AGENT_TURN_APPROVAL_LAST_TURN_DIVERGED', lastTurn.turnId, command.turnId)
          }
          lastTurn = {
            turnId: command.turnId,
            status: 'waiting_approval',
            stopReason: 'awaiting_approval',
            errorCode: null,
          }
          approvalResolution = receipt
        }
        return receipt
      } finally {
        approvalResolutionInFlight = false
      }
    },
    {
      validator: validateApprovalCommand,
      description: 'Resolve one persisted Agent Turn approval and resume that Turn.',
    },
  )

  try {
    const recovered = await admissionActivities.recoverAgentThread({
      workflowId: input.workflowId,
      threadId: input.threadId,
    })
    for (const entry of recovered.queued) {
      if (
        entry.turn.threadId !== input.threadId ||
        entry.turn.status !== 'queued' ||
        entry.payloadHash !== entry.turn.payloadHash ||
        !entry.commandId
      ) {
        return fail('AGENT_THREAD_RECOVERY_QUEUE_DIVERGED')
      }
      queued.push(entry)
    }
    if (recovered.waitingApproval) {
      if (
        recovered.waitingApproval.status !== 'waiting_approval' ||
        recovered.waitingApproval.turnId === recovered.pendingChoiceTurnId
      ) {
        return fail('AGENT_THREAD_RECOVERY_APPROVAL_DIVERGED')
      }
      lastTurn = recovered.waitingApproval
    } else if (recovered.recoveredTurns.length > 0) {
      const recoveredTurn = recovered.recoveredTurns[recovered.recoveredTurns.length - 1]
      if (!recoveredTurn || recoveredTurn.status !== 'interrupted') {
        return fail('AGENT_THREAD_RECOVERY_TURN_DIVERGED')
      }
      lastTurn = {
        turnId: recoveredTurn.id,
        status: 'interrupted',
        stopReason: recoveredTurn.stopReason,
        errorCode: recoveredTurn.errorCode,
      }
    }
    if (recovered.resolvedApproval) {
      if (
        lastTurn?.status !== 'waiting_approval' ||
        recovered.resolvedApproval.turnId !== lastTurn.turnId ||
        recovered.resolvedApproval.threadId !== input.threadId ||
        !recovered.resolvedApproval.resumeRequired
      ) {
        return fail('AGENT_THREAD_RECOVERY_APPROVAL_RECEIPT_DIVERGED')
      }
      approvalResolution = recovered.resolvedApproval
    }
    pendingChoiceTurnId = recovered.pendingChoiceTurnId
    if (
      queued.length > 0 ||
      lastTurn !== null ||
      pendingChoiceTurnId !== null ||
      !recovered.threadExists
    ) {
      hasAcceptedCommand = true
    }
  } finally {
    recoveryInFlight = false
  }

  await condition(() => hasAcceptedCommand || hasHandledCommand || threadCleared)
  while (true) {
    if (threadCleared) {
      await condition(() => allHandlersFinished())
      return {
        workflowId: input.workflowId,
        threadId: input.threadId,
        lastTurn,
      }
    }
    if (pendingChoiceTurnId !== null) {
      await condition(() => pendingChoiceTurnId === null || threadCleared)
      continue
    }
    if (lastTurn?.status === 'waiting_approval') {
      await resumePendingApproval()
      continue
    }
    if (queued.length === 0) {
      await condition(
        () => queued.length > 0 || threadCleared || (!admissionInFlight && allHandlersFinished()),
      )
      if (threadCleared) continue
      if (queued.length === 0 && !admissionInFlight && allHandlersFinished()) {
        return {
          workflowId: input.workflowId,
          threadId: input.threadId,
          lastTurn,
        }
      }
    }
    const next = queued.shift()
    if (!next) continue
    activeTurnId = next.turn.id
    const executionOwnerId = [input.workflowId, next.turn.id, next.commandId].join(':')
    const executionScope = new CancellationScope()
    activeExecutionScope = executionScope
    try {
      lastTurn = await executionScope.run(
        async () =>
          await executionActivities.executeAgentTurn({
            workflowId: input.workflowId,
            threadId: input.threadId,
            turnId: next.turn.id,
            executionOwnerId,
          }),
      )
    } catch (error) {
      if (threadCleared) {
        lastTurn = {
          turnId: next.turn.id,
          status: 'cancelled',
          stopReason: 'thread_cleared',
          errorCode: null,
        }
      } else {
        lastTurn = await settlementActivities.settleLostAgentTurn({
          workflowId: input.workflowId,
          threadId: input.threadId,
          turnId: next.turn.id,
          executionOwnerId,
          errorCode: 'AGENT_TURN_ACTIVITY_LOST',
          errorMessage: activityErrorMessage(error),
        })
      }
    } finally {
      activeExecutionScope = null
      activeTurnId = null
    }
    if (lastTurn.status === 'completed' && lastTurn.stopReason === 'awaiting_choice') {
      pendingChoiceTurnId = lastTurn.turnId
    }
    await resumePendingApproval()
  }
}
