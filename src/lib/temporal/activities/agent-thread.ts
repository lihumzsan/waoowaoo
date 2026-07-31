import { ApplicationFailure, Context, activityInfo, heartbeat } from '@temporalio/activity'
import { getErrorSpec } from '@/lib/errors/codes'
import type { LlmUsageFact } from '@/lib/billing/llm-usage'
import { describeUnknownError, normalizeAnyError } from '@/lib/errors/normalize'
import {
  acceptAgentTurnCommand,
  claimAgentTurnExecution,
  completeAgentTurnExecution,
  failAgentTurnExecution,
  loadClaimedAgentTurnExecutionInput,
  recoverAgentThreadCoordinatorState,
  settleAgentTurnAfterActivityLoss,
} from '@/lib/agent-turn/service'
import {
  claimAgentTurnApprovalResume,
  prepareAgentTurnApprovalPayload,
  resolveAgentTurnApprovalDecision,
  suspendAgentTurnForApproval,
} from '@/lib/agent-turn/approval'
import { runAgentTurn, type AgentTurnRunnerResult } from '@/lib/agent-turn/runner'
import {
  buildAgentTurnAssistantMessageId,
  createAgentTurnStreamPublisher,
  publishAgentSessionViewChanged,
  type AgentTurnStreamPublisher,
} from '@/lib/agent-turn/stream-publisher'
import {
  resolveAgentTurnChoice as resolveAgentTurnChoiceFact,
  settleAgentTurnChoiceOffer,
} from '@/lib/agent-turn/choice'
import { buildAgentTurnEnvelope } from '@/lib/agent-turn/identity'
import { hashCanonicalJson } from '@/lib/operation-plan-contract/canonical-json'
import { AGENT_TURN_PROTOCOL } from '@/lib/agent-turn/contracts'
import {
  cancelAgentTurn as cancelAgentTurnFact,
  clearAgentThread as clearAgentThreadFact,
} from '@/lib/agent-turn/lifecycle'
import { recordObservedAgentTurnUsageFacts } from '@/lib/agent-turn/usage'
import type {
  AgentTurnAdmissionReceipt,
  AgentTurnExecutionInput,
  AgentTurnExecutionResult,
  AgentTurnRecord,
} from '@/lib/agent-turn/contracts'
import { buildAgentThreadWorkflowId } from '@/lib/temporal/identity'
import type {
  AdmitAgentTurnActivityInput,
  CancelAgentTurnActivityInput,
  ClearAgentThreadActivityInput,
  ExecuteAgentTurnActivityInput,
  ResolveAgentTurnApprovalActivityInput,
  ResolveAgentTurnChoiceActivityInput,
  RecoverAgentThreadActivityInput,
  ResumeAgentTurnApprovalActivityInput,
  AgentThreadRecoveryReceipt,
  SettleLostAgentTurnActivityInput,
} from '../agent-thread/contracts'
import type { AgentTurnChoiceResolutionReceipt } from '../agent-thread/contracts'

function failNonRetryable(code: string, ...details: unknown[]): never {
  throw ApplicationFailure.nonRetryable(code, code, ...details)
}

function normalizePersistedAgentError(error: unknown): {
  errorCode: string
  errorMessage: string
} {
  const normalized = normalizeAnyError(error, {
    context: 'worker',
    fallbackCode: 'GENERATION_FAILED',
  })
  return {
    errorCode: normalized.code,
    errorMessage: getErrorSpec(normalized.code).defaultMessage,
  }
}

async function runAgentCommandOwner<T>(owner: () => Promise<T>): Promise<T> {
  try {
    return await owner()
  } catch (error) {
    const message = describeUnknownError(error)
    const [code] = message.split(':', 1)
    if (code.startsWith('AGENT_TURN_') || code.startsWith('AGENT_THREAD_')) {
      return failNonRetryable(code, message)
    }
    throw error
  }
}

function requireWorkflowIdentity(params: { workflowId: string; threadId: string }): void {
  const expected = buildAgentThreadWorkflowId(params.threadId)
  const actual = activityInfo().workflowExecution?.workflowId
  if (params.workflowId !== expected || !actual || actual !== params.workflowId) {
    failNonRetryable(
      'AGENT_THREAD_ACTIVITY_WORKFLOW_DIVERGED',
      actual ?? null,
      params.workflowId,
      expected,
    )
  }
}

async function publishTurnViewChanged(params: {
  turn: AgentTurnRecord
  reason: string
}): Promise<void> {
  await publishAgentSessionViewChanged({
    projectId: params.turn.projectId,
    userId: params.turn.userId,
    episodeId: params.turn.episodeId,
    threadId: params.turn.threadId,
    turnId: params.turn.id,
    attempt: params.turn.attempt > 0 ? params.turn.attempt : null,
    reason: params.reason,
  })
}

export async function admitAgentTurn(
  input: AdmitAgentTurnActivityInput,
): Promise<AgentTurnAdmissionReceipt> {
  requireWorkflowIdentity({
    workflowId: input.workflowId,
    threadId: input.envelope.command.threadId,
  })
  const decision = await runAgentCommandOwner(
    async () => await acceptAgentTurnCommand(input.envelope),
  )
  const base = {
    workflowId: input.workflowId,
    commandId: input.envelope.commandId,
    payloadHash: input.envelope.payloadHash,
    threadId: input.envelope.command.threadId,
  }
  const receipt: AgentTurnAdmissionReceipt =
    decision.outcome === 'accepted'
      ? {
          ...base,
          outcome: 'accepted',
          turn: decision.turn,
          ignoredReason: null,
        }
      : {
          ...base,
          outcome: 'ignored',
          turn: null,
          ignoredReason: decision.reason,
        }
  if (decision.outcome === 'accepted') {
    await publishTurnViewChanged({
      turn: decision.turn,
      reason: 'turn_admitted',
    })
  }
  return receipt
}

export async function recoverAgentThread(
  input: RecoverAgentThreadActivityInput,
): Promise<AgentThreadRecoveryReceipt> {
  requireWorkflowIdentity(input)
  const state = await runAgentCommandOwner(
    async () => await recoverAgentThreadCoordinatorState(input.threadId),
  )
  for (const turn of state.recoveredTurns) {
    await publishTurnViewChanged({ turn, reason: 'turn_interrupted' })
  }
  const resolvedApproval = state.resolvedApproval
    ? {
        protocol: 'agent_turn_approval_receipt_v1' as const,
        threadId: state.resolvedApproval.threadId,
        turnId: state.resolvedApproval.turnId,
        interactionId: state.resolvedApproval.interactionId,
        projectId: state.resolvedApproval.projectId,
        episodeId: state.resolvedApproval.episodeId,
        requestId: state.resolvedApproval.requestId,
        decision: state.resolvedApproval.decision,
        payloadHash: hashCanonicalJson({
          protocol: 'agent_turn_approval_response_v1',
          threadId: state.resolvedApproval.threadId,
          turnId: state.resolvedApproval.turnId,
          interactionId: state.resolvedApproval.interactionId,
          projectId: state.resolvedApproval.projectId,
          userId: state.resolvedApproval.userId,
          requestId: state.resolvedApproval.requestId,
          decision: state.resolvedApproval.decision,
          reason: state.resolvedApproval.reason,
        }),
        resumeRequired: true,
      }
    : null
  return {
    threadExists: state.threadExists,
    queued: state.queuedTurns.map((turn) => ({
      commandId: `agent-turn-recovered:${turn.id}`,
      payloadHash: turn.payloadHash,
      turn,
    })),
    recoveredTurns: state.recoveredTurns,
    waitingApproval: state.waitingApproval,
    resolvedApproval,
    pendingChoiceTurnId: state.pendingChoiceTurnId,
  }
}

function startTurnHeartbeat(params: { turnId: string; executionOwnerId: string }): () => void {
  const beat = (): void => {
    heartbeat({
      protocol: 'agent_turn_v1',
      turnId: params.turnId,
      executionOwnerId: params.executionOwnerId,
    })
  }
  beat()
  const timer = setInterval(beat, 10_000)
  timer.unref()
  return () => clearInterval(timer)
}

async function settleRunnerResult(params: {
  executionInput: AgentTurnExecutionInput
  executionOwnerId: string
  result: AgentTurnRunnerResult
  signal: AbortSignal
}): Promise<AgentTurnExecutionResult> {
  if (params.result.status === 'waiting_approval') {
    const payload = await prepareAgentTurnApprovalPayload({
      input: params.executionInput,
      approvals: params.result.approvals,
      signal: params.signal,
    })
    await suspendAgentTurnForApproval({
      input: params.executionInput,
      executionOwnerId: params.executionOwnerId,
      assistantMessage: params.result.assistantMessage,
      modelHistoryItems: params.result.modelHistoryItems,
      runState: params.result.runState,
      payload,
      usageFacts: params.result.usageFacts,
    })
    return {
      turnId: params.executionInput.turn.id,
      status: 'waiting_approval',
      stopReason: 'awaiting_approval',
      errorCode: null,
    }
  }
  if (params.result.status === 'waiting_choice') {
    await settleAgentTurnChoiceOffer({
      input: params.executionInput,
      executionOwnerId: params.executionOwnerId,
      assistantMessage: params.result.assistantMessage,
      modelHistoryItems: params.result.modelHistoryItems,
      offer: params.result.offer,
      usageFacts: params.result.usageFacts,
    })
    return {
      turnId: params.executionInput.turn.id,
      status: 'completed',
      stopReason: 'awaiting_choice',
      errorCode: null,
    }
  }
  const turn = await completeAgentTurnExecution({
    turnId: params.executionInput.turn.id,
    executionOwnerId: params.executionOwnerId,
    assistantMessage: params.result.assistantMessage,
    modelHistoryItems: params.result.modelHistoryItems,
    usageFacts: params.result.usageFacts,
    stopReason: params.result.stopReason,
  })
  return {
    turnId: turn.id,
    status: 'completed',
    stopReason: turn.stopReason,
    errorCode: null,
  }
}

export async function executeAgentTurn(
  input: ExecuteAgentTurnActivityInput,
): Promise<AgentTurnExecutionResult> {
  requireWorkflowIdentity(input)
  const claimedTurn = await claimAgentTurnExecution({
    turnId: input.turnId,
    executionOwnerId: input.executionOwnerId,
  })
  await publishTurnViewChanged({
    turn: claimedTurn,
    reason: 'turn_running',
  })
  const stopHeartbeat = startTurnHeartbeat(input)
  let streamPublisher: AgentTurnStreamPublisher | null = null
  let executionInput: AgentTurnExecutionInput | null = null
  let observedUsageFacts: readonly LlmUsageFact[] = []
  try {
    const cancellationSignal = Context.current().cancellationSignal
    cancellationSignal.throwIfAborted()
    executionInput = await loadClaimedAgentTurnExecutionInput({
      turnId: input.turnId,
      executionOwnerId: input.executionOwnerId,
    })
    streamPublisher = createAgentTurnStreamPublisher({
      projectId: executionInput.turn.projectId,
      userId: executionInput.turn.userId,
      episodeId: executionInput.turn.episodeId,
      threadId: executionInput.turn.threadId,
      turnId: executionInput.turn.id,
      attempt: executionInput.turn.attempt,
      messageId: buildAgentTurnAssistantMessageId({
        turnId: executionInput.turn.id,
        attempt: executionInput.turn.attempt,
      }),
    })
    const result = await runAgentTurn({
      input: executionInput,
      executionOwnerId: input.executionOwnerId,
      signal: cancellationSignal,
      publishUiChunk: streamPublisher.publish,
      onUsageObserved: (usageFacts) => {
        observedUsageFacts = usageFacts
      },
    })
    await streamPublisher.flush()
    const settled = await settleRunnerResult({
      executionInput,
      executionOwnerId: input.executionOwnerId,
      result,
      signal: cancellationSignal,
    })
    await publishAgentSessionViewChanged({
      projectId: executionInput.turn.projectId,
      userId: executionInput.turn.userId,
      episodeId: executionInput.turn.episodeId,
      threadId: executionInput.turn.threadId,
      turnId: executionInput.turn.id,
      attempt: executionInput.turn.attempt,
      reason: `turn_${settled.status}`,
    })
    return settled
  } catch (error) {
    if (Context.current().cancellationSignal.aborted) {
      if (executionInput && observedUsageFacts.length > 0) {
        await recordObservedAgentTurnUsageFacts({
          turnId: executionInput.turn.id,
          attempt: executionInput.turn.attempt,
          projectId: executionInput.turn.projectId,
          userId: executionInput.turn.userId,
          usageFacts: observedUsageFacts,
        })
      }
      throw error
    }
    await streamPublisher?.flush()
    Context.current().log.error('Agent Turn execution failed', {
      turnId: input.turnId,
      error: describeUnknownError(error),
    })
    const persistedError = normalizePersistedAgentError(error)
    const turn = await failAgentTurnExecution({
      turnId: input.turnId,
      executionOwnerId: input.executionOwnerId,
      errorCode: persistedError.errorCode,
      errorMessage: persistedError.errorMessage,
      usageFacts: observedUsageFacts,
    })
    await publishTurnViewChanged({ turn, reason: 'turn_failed' })
    return {
      turnId: turn.id,
      status: 'failed',
      stopReason: turn.stopReason,
      errorCode: turn.errorCode,
    }
  } finally {
    await streamPublisher?.flush()
    stopHeartbeat()
  }
}

export async function resolveAgentTurnApproval(input: ResolveAgentTurnApprovalActivityInput) {
  requireWorkflowIdentity({
    workflowId: input.workflowId,
    threadId: input.command.threadId,
  })
  const receipt = await runAgentCommandOwner(
    async () => await resolveAgentTurnApprovalDecision(input.command),
  )
  await publishAgentSessionViewChanged({
    projectId: input.command.projectId,
    userId: input.command.userId,
    episodeId: receipt.episodeId,
    threadId: input.command.threadId,
    turnId: input.command.turnId,
    attempt: null,
    reason: `approval_${receipt.decision}`,
  })
  return receipt
}

export async function resolveAgentTurnChoice(
  input: ResolveAgentTurnChoiceActivityInput,
): Promise<AgentTurnChoiceResolutionReceipt> {
  requireWorkflowIdentity({
    workflowId: input.workflowId,
    threadId: input.command.threadId,
  })
  const resolution = await runAgentCommandOwner(
    async () => await resolveAgentTurnChoiceFact(input.command),
  )
  await publishAgentSessionViewChanged({
    projectId: resolution.projectId,
    userId: resolution.userId,
    episodeId: resolution.context.episodeId,
    threadId: resolution.threadId,
    turnId: resolution.originalTurnId,
    attempt: null,
    reason: 'choice_resolved',
  })
  return {
    resolution,
    envelope: buildAgentTurnEnvelope({
      protocol: AGENT_TURN_PROTOCOL,
      threadId: resolution.threadId,
      projectId: resolution.projectId,
      userId: resolution.userId,
      assistantId: 'workspace-command',
      sourceKind: 'choice_response',
      sourceId: resolution.offerId,
      requestId: resolution.requestId,
      userMessage: null,
      context: resolution.context,
    }),
  }
}

export async function cancelAgentTurn(input: CancelAgentTurnActivityInput) {
  requireWorkflowIdentity({
    workflowId: input.workflowId,
    threadId: input.command.threadId,
  })
  const receipt = await runAgentCommandOwner(async () => await cancelAgentTurnFact(input.command))
  await publishAgentSessionViewChanged({
    projectId: input.command.projectId,
    userId: input.command.userId,
    episodeId: receipt.episodeId,
    threadId: input.command.threadId,
    turnId: input.command.turnId,
    attempt: null,
    reason: 'turn_cancelled',
  })
  return receipt
}

export async function clearAgentThread(input: ClearAgentThreadActivityInput) {
  requireWorkflowIdentity({
    workflowId: input.workflowId,
    threadId: input.command.threadId,
  })
  const receipt = await runAgentCommandOwner(async () => await clearAgentThreadFact(input.command))
  await publishAgentSessionViewChanged({
    projectId: input.command.projectId,
    userId: input.command.userId,
    episodeId: input.command.episodeId,
    threadId: input.command.threadId,
    turnId: null,
    attempt: null,
    reason: 'thread_cleared',
  })
  return receipt
}

export async function resumeAgentTurnApproval(
  input: ResumeAgentTurnApprovalActivityInput,
): Promise<AgentTurnExecutionResult> {
  requireWorkflowIdentity(input)
  const resume = await claimAgentTurnApprovalResume({
    interactionId: input.interactionId,
    executionOwnerId: input.executionOwnerId,
  })
  if (resume.input.turn.id !== input.turnId || resume.input.turn.threadId !== input.threadId) {
    return failNonRetryable(
      'AGENT_TURN_APPROVAL_RESUME_SCOPE_DIVERGED',
      input.turnId,
      resume.input.turn.id,
    )
  }
  const stopHeartbeat = startTurnHeartbeat(input)
  let streamPublisher: AgentTurnStreamPublisher | null = null
  let observedUsageFacts: readonly LlmUsageFact[] = []
  try {
    const cancellationSignal = Context.current().cancellationSignal
    cancellationSignal.throwIfAborted()
    streamPublisher = createAgentTurnStreamPublisher({
      projectId: resume.input.turn.projectId,
      userId: resume.input.turn.userId,
      episodeId: resume.input.turn.episodeId,
      threadId: resume.input.turn.threadId,
      turnId: resume.input.turn.id,
      attempt: resume.input.turn.attempt,
      messageId: buildAgentTurnAssistantMessageId({
        turnId: resume.input.turn.id,
        attempt: resume.input.turn.attempt,
      }),
    })
    const result = await runAgentTurn({
      input: resume.input,
      executionOwnerId: input.executionOwnerId,
      signal: cancellationSignal,
      approvalResume: resume,
      publishUiChunk: streamPublisher.publish,
      onUsageObserved: (usageFacts) => {
        observedUsageFacts = usageFacts
      },
    })
    await streamPublisher.flush()
    const settled = await settleRunnerResult({
      executionInput: resume.input,
      executionOwnerId: input.executionOwnerId,
      result,
      signal: cancellationSignal,
    })
    await publishAgentSessionViewChanged({
      projectId: resume.input.turn.projectId,
      userId: resume.input.turn.userId,
      episodeId: resume.input.turn.episodeId,
      threadId: resume.input.turn.threadId,
      turnId: resume.input.turn.id,
      attempt: resume.input.turn.attempt,
      reason: `turn_${settled.status}`,
    })
    return settled
  } catch (error) {
    if (Context.current().cancellationSignal.aborted) {
      if (observedUsageFacts.length > 0) {
        await recordObservedAgentTurnUsageFacts({
          turnId: resume.input.turn.id,
          attempt: resume.input.turn.attempt,
          projectId: resume.input.turn.projectId,
          userId: resume.input.turn.userId,
          usageFacts: observedUsageFacts,
        })
      }
      throw error
    }
    await streamPublisher?.flush()
    Context.current().log.error('Agent Turn approval resume failed', {
      turnId: input.turnId,
      interactionId: input.interactionId,
      error: describeUnknownError(error),
    })
    const persistedError = normalizePersistedAgentError(error)
    const turn = await failAgentTurnExecution({
      turnId: input.turnId,
      executionOwnerId: input.executionOwnerId,
      errorCode: persistedError.errorCode,
      errorMessage: persistedError.errorMessage,
      usageFacts: observedUsageFacts,
    })
    await publishTurnViewChanged({ turn, reason: 'turn_failed' })
    return {
      turnId: turn.id,
      status: 'failed',
      stopReason: turn.stopReason,
      errorCode: turn.errorCode,
    }
  } finally {
    await streamPublisher?.flush()
    stopHeartbeat()
  }
}

export async function settleLostAgentTurn(
  input: SettleLostAgentTurnActivityInput,
): Promise<AgentTurnExecutionResult> {
  requireWorkflowIdentity(input)
  try {
    Context.current().log.warn('Agent Turn Activity lost before acknowledgement', {
      turnId: input.turnId,
      activityErrorCode: input.errorCode,
      activityError: input.errorMessage,
    })
    const turn = await settleAgentTurnAfterActivityLoss({
      turnId: input.turnId,
      executionOwnerId: input.executionOwnerId,
      errorCode: 'GENERATION_FAILED',
      errorMessage: getErrorSpec('GENERATION_FAILED').defaultMessage,
    })
    await publishTurnViewChanged({ turn, reason: `turn_${turn.status}` })
    if (turn.status === 'queued' || turn.status === 'running') {
      return failNonRetryable('AGENT_TURN_LOST_SETTLEMENT_NON_TERMINAL', turn.id, turn.status)
    }
    return {
      turnId: turn.id,
      status: turn.status,
      stopReason: turn.stopReason,
      errorCode: turn.errorCode,
    }
  } catch (error) {
    return failNonRetryable('AGENT_TURN_LOST_SETTLEMENT_FAILED', describeUnknownError(error))
  }
}
