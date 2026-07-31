import {
  WithStartWorkflowOperation,
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
  WorkflowUpdateFailedError,
  type WorkflowClient,
} from '@temporalio/client'
import {
  buildAgentTurnEnvelope,
  buildAgentTurnId,
} from '@/lib/agent-turn/identity'
import type {
  AgentTurnAdmissionReceipt,
  AgentTurnCommandEnvelope,
  AgentTurnRecord,
  AgentTurnStatus,
  SubmitAgentTurnCommand,
} from '@/lib/agent-turn/contracts'
import type {
  AgentTurnApprovalDecisionReceipt,
  ResolveAgentTurnApprovalCommand,
} from '@/lib/agent-turn/approval'
import type { ResolveAgentTurnChoiceCommand } from '@/lib/agent-turn/choice'
import type {
  AgentThreadClearReceipt,
  AgentTurnCancellationReceipt,
  CancelAgentTurnCommand,
  ClearAgentThreadCommand,
} from '@/lib/agent-turn/lifecycle'
import { hashCanonicalJson } from '@/lib/operation-plan-contract/canonical-json'
import { getTemporalClient } from '../client'
import { getTemporalRuntimeConfig } from '../config'
import { buildAgentThreadWorkflowId } from '../identity'
import { TEMPORAL_WORKFLOW_TYPE } from '../task/contracts'
import {
  AGENT_THREAD_UPDATE_NAME,
  type AgentThreadCoordinatorResult,
  type AgentThreadCoordinatorWorkflowInput,
} from './contracts'

type AgentThreadCoordinatorWorkflow = (
  input: AgentThreadCoordinatorWorkflowInput,
) => Promise<AgentThreadCoordinatorResult>

export class TemporalAgentTurnCommandUnconfirmedError extends Error {
  readonly code = 'TEMPORAL_AGENT_TURN_COMMAND_UNCONFIRMED'
  override readonly cause: unknown

  constructor(
    readonly commandId: string,
    cause: unknown,
  ) {
    super(`Temporal Agent Turn acknowledgement is unconfirmed: ${commandId}`)
    this.name = 'TemporalAgentTurnCommandUnconfirmedError'
    this.cause = cause
  }
}

export class TemporalAgentTurnCommandConflictError extends Error {
  readonly code = 'AGENT_TURN_COMMAND_REPLAY_DIVERGED'

  constructor(readonly commandId: string) {
    super(`AGENT_TURN_COMMAND_REPLAY_DIVERGED:${commandId}`)
    this.name = 'TemporalAgentTurnCommandConflictError'
  }
}

function isStatus(value: unknown): value is AgentTurnStatus {
  return (
    value === 'queued' ||
    value === 'running' ||
    value === 'waiting_approval' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'interrupted' ||
    value === 'cancelled'
  )
}

function parseTurn(
  value: unknown,
  envelope: AgentTurnCommandEnvelope,
): AgentTurnRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AGENT_TURN_RECEIPT_INVALID')
  }
  const record = value as Record<string, unknown>
  const command = envelope.command
  const expectedTurnId = buildAgentTurnId(command)
  if (
    record.id !== expectedTurnId ||
    record.threadId !== command.threadId ||
    record.projectId !== command.projectId ||
    record.userId !== command.userId ||
    record.episodeId !== command.context.episodeId ||
    record.sourceKind !== command.sourceKind ||
    record.sourceId !== command.sourceId ||
    record.payloadHash !== envelope.payloadHash ||
    record.requestId !== command.requestId ||
    !isStatus(record.status) ||
    !Number.isSafeInteger(record.attempt) ||
    (record.attempt as number) < 0 ||
    (record.modelHistoryBaseVersion !== null &&
      (!Number.isSafeInteger(record.modelHistoryBaseVersion) ||
        (record.modelHistoryBaseVersion as number) < 0)) ||
    (record.stopReason !== null && typeof record.stopReason !== 'string') ||
    (record.errorCode !== null && typeof record.errorCode !== 'string') ||
    (record.errorMessage !== null && typeof record.errorMessage !== 'string')
  ) {
    throw new Error('AGENT_TURN_RECEIPT_DIVERGED')
  }
  return {
    id: expectedTurnId,
    threadId: command.threadId,
    projectId: command.projectId,
    userId: command.userId,
    episodeId: command.context.episodeId,
    sourceKind: command.sourceKind,
    sourceId: command.sourceId,
    payloadHash: envelope.payloadHash,
    requestId: command.requestId,
    status: record.status,
    attempt: record.attempt as number,
    modelHistoryBaseVersion: record.modelHistoryBaseVersion as number | null,
    stopReason: record.stopReason as string | null,
    errorCode: record.errorCode as string | null,
    errorMessage: record.errorMessage as string | null,
  }
}

function parseReceipt(
  value: unknown,
  expected: {
    workflowId: string
    envelope: AgentTurnCommandEnvelope
  },
): AgentTurnAdmissionReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AGENT_TURN_ADMISSION_RECEIPT_INVALID')
  }
  const record = value as Record<string, unknown>
  if (
    record.workflowId !== expected.workflowId ||
    record.commandId !== expected.envelope.commandId ||
    record.threadId !== expected.envelope.command.threadId
  ) {
    throw new Error('AGENT_TURN_ADMISSION_RECEIPT_DIVERGED')
  }
  if (record.payloadHash !== expected.envelope.payloadHash) {
    throw new TemporalAgentTurnCommandConflictError(
      expected.envelope.commandId,
    )
  }
  if (record.outcome === 'ignored') {
    if (
      expected.envelope.command.sourceKind !== 'task_follow_up' ||
      record.turn !== null ||
      record.ignoredReason !== 'source_cancelled'
    ) {
      throw new Error('AGENT_TURN_IGNORED_RECEIPT_DIVERGED')
    }
    return {
      workflowId: expected.workflowId,
      commandId: expected.envelope.commandId,
      payloadHash: expected.envelope.payloadHash,
      threadId: expected.envelope.command.threadId,
      outcome: 'ignored',
      turn: null,
      ignoredReason: 'source_cancelled',
    }
  }
  if (record.outcome !== 'accepted' || record.ignoredReason !== null) {
    throw new Error('AGENT_TURN_ACCEPTED_RECEIPT_DIVERGED')
  }
  return {
    workflowId: expected.workflowId,
    commandId: expected.envelope.commandId,
    payloadHash: expected.envelope.payloadHash,
    threadId: expected.envelope.command.threadId,
    outcome: 'accepted',
    turn: parseTurn(record.turn, expected.envelope),
    ignoredReason: null,
  }
}

function parseChoiceReceipt(
  value: unknown,
  expected: {
    workflowId: string
    command: ResolveAgentTurnChoiceCommand
  },
): AgentTurnAdmissionReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AGENT_TURN_CHOICE_ADMISSION_RECEIPT_INVALID')
  }
  const record = value as Record<string, unknown>
  const turnValue = record.turn
  if (
    record.workflowId !== expected.workflowId ||
    record.threadId !== expected.command.threadId ||
    typeof record.commandId !== 'string' ||
    !record.commandId ||
    typeof record.payloadHash !== 'string' ||
    !record.payloadHash ||
    record.outcome !== 'accepted' ||
    record.ignoredReason !== null ||
    !turnValue ||
    typeof turnValue !== 'object' ||
    Array.isArray(turnValue)
  ) {
    throw new Error('AGENT_TURN_CHOICE_ADMISSION_RECEIPT_DIVERGED')
  }
  const turn = turnValue as Record<string, unknown>
  if (
    typeof turn.id !== 'string' ||
    !turn.id ||
    turn.threadId !== expected.command.threadId ||
    turn.projectId !== expected.command.projectId ||
    turn.userId !== expected.command.userId ||
    (turn.episodeId !== null && typeof turn.episodeId !== 'string') ||
    turn.sourceKind !== 'choice_response' ||
    turn.sourceId !== expected.command.offerId ||
    turn.payloadHash !== record.payloadHash ||
    turn.requestId !== expected.command.requestId ||
    !isStatus(turn.status) ||
    !Number.isSafeInteger(turn.attempt) ||
    (turn.attempt as number) < 0 ||
    (turn.modelHistoryBaseVersion !== null &&
      (!Number.isSafeInteger(turn.modelHistoryBaseVersion) ||
        (turn.modelHistoryBaseVersion as number) < 0)) ||
    (turn.stopReason !== null && typeof turn.stopReason !== 'string') ||
    (turn.errorCode !== null && typeof turn.errorCode !== 'string') ||
    (turn.errorMessage !== null && typeof turn.errorMessage !== 'string')
  ) {
    throw new Error('AGENT_TURN_CHOICE_ADMISSION_TURN_DIVERGED')
  }
  return {
    workflowId: expected.workflowId,
    commandId: record.commandId,
    payloadHash: record.payloadHash,
    threadId: expected.command.threadId,
    outcome: 'accepted',
    turn: {
      id: turn.id,
      threadId: expected.command.threadId,
      projectId: expected.command.projectId,
      userId: expected.command.userId,
      episodeId: turn.episodeId as string | null,
      sourceKind: 'choice_response',
      sourceId: expected.command.offerId,
      payloadHash: record.payloadHash,
      requestId: expected.command.requestId,
      status: turn.status,
      attempt: turn.attempt as number,
      modelHistoryBaseVersion: turn.modelHistoryBaseVersion as number | null,
      stopReason: turn.stopReason as string | null,
      errorCode: turn.errorCode as string | null,
      errorMessage: turn.errorMessage as string | null,
    },
    ignoredReason: null,
  }
}

function parseApprovalReceipt(
  value: unknown,
  command: ResolveAgentTurnApprovalCommand,
): AgentTurnApprovalDecisionReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AGENT_TURN_APPROVAL_RECEIPT_INVALID')
  }
  const record = value as Record<string, unknown>
  const payloadHash = hashCanonicalJson(command)
  if (
    record.protocol !== 'agent_turn_approval_receipt_v1'
    || record.threadId !== command.threadId
    || record.turnId !== command.turnId
    || record.interactionId !== command.interactionId
    || record.projectId !== command.projectId
    || record.requestId !== command.requestId
    || record.decision !== command.decision
    || record.payloadHash !== payloadHash
    || typeof record.resumeRequired !== 'boolean'
  ) {
    throw new Error('AGENT_TURN_APPROVAL_RECEIPT_DIVERGED')
  }
  return record as unknown as AgentTurnApprovalDecisionReceipt
}

function parseCancellationReceipt(
  value: unknown,
  command: CancelAgentTurnCommand,
): AgentTurnCancellationReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AGENT_TURN_CANCEL_RECEIPT_INVALID')
  }
  const record = value as Record<string, unknown>
  if (
    record.protocol !== 'agent_turn_cancellation_receipt_v1'
    || record.threadId !== command.threadId
    || record.projectId !== command.projectId
    || record.turnId !== command.turnId
    || record.requestId !== command.requestId
    || record.status !== 'cancelled'
  ) {
    throw new Error('AGENT_TURN_CANCEL_RECEIPT_DIVERGED')
  }
  return record as unknown as AgentTurnCancellationReceipt
}

export class TemporalAgentThreadClient {
  constructor(
    private readonly workflowClient: WorkflowClient,
    private readonly taskQueue: string,
  ) {
    if (!taskQueue || taskQueue !== taskQueue.trim()) {
      throw new Error('TEMPORAL_TASK_QUEUE_INVALID')
    }
  }

  async submit(
    command: SubmitAgentTurnCommand,
  ): Promise<AgentTurnAdmissionReceipt> {
    const envelope = buildAgentTurnEnvelope(command)
    const workflowId = buildAgentThreadWorkflowId(command.threadId)
    let lastError: unknown = null
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const startOperation =
        new WithStartWorkflowOperation<AgentThreadCoordinatorWorkflow>(
          TEMPORAL_WORKFLOW_TYPE.AGENT_THREAD_COORDINATOR,
          {
            workflowId,
            workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
            workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
            taskQueue: this.taskQueue,
            args: [
              {
                workflowId,
                threadId: command.threadId,
              },
            ],
          },
        )
      try {
        const value = await this.workflowClient.executeUpdateWithStart<
          AgentThreadCoordinatorWorkflow,
          unknown,
          [AgentTurnCommandEnvelope]
        >(AGENT_THREAD_UPDATE_NAME.SUBMIT_TURN, {
          updateId: envelope.commandId,
          args: [envelope],
          startWorkflowOperation: startOperation,
        })
        return parseReceipt(value, { workflowId, envelope })
      } catch (error) {
        if (
          error instanceof WorkflowUpdateFailedError
          || error instanceof TemporalAgentTurnCommandConflictError
        ) {
          throw error
        }
        lastError = error
        if (!(error instanceof WorkflowExecutionAlreadyStartedError)) {
          continue
        }
        try {
          const value = await this.workflowClient
            .getHandle<AgentThreadCoordinatorWorkflow>(workflowId)
            .executeUpdate<
              AgentTurnAdmissionReceipt,
              [AgentTurnCommandEnvelope]
            >(AGENT_THREAD_UPDATE_NAME.SUBMIT_TURN, {
              updateId: envelope.commandId,
              args: [envelope],
            })
          return parseReceipt(value, { workflowId, envelope })
        } catch (updateError) {
          if (
            updateError instanceof WorkflowUpdateFailedError
            || updateError instanceof TemporalAgentTurnCommandConflictError
          ) {
            throw updateError
          }
          lastError = updateError
        }
      }
    }
    throw new TemporalAgentTurnCommandUnconfirmedError(
      envelope.commandId,
      lastError,
    )
  }

  async resolveApproval(
    command: ResolveAgentTurnApprovalCommand,
  ): Promise<AgentTurnApprovalDecisionReceipt> {
    const workflowId = buildAgentThreadWorkflowId(command.threadId)
    const updateId = `agent-turn-approval:${hashCanonicalJson(command)}`
    let lastError: unknown = null
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const startOperation =
        new WithStartWorkflowOperation<AgentThreadCoordinatorWorkflow>(
          TEMPORAL_WORKFLOW_TYPE.AGENT_THREAD_COORDINATOR,
          {
            workflowId,
            workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
            workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
            taskQueue: this.taskQueue,
            args: [{ workflowId, threadId: command.threadId }],
          },
        )
      try {
        const value = await this.workflowClient.executeUpdateWithStart<
          AgentThreadCoordinatorWorkflow,
          unknown,
          [ResolveAgentTurnApprovalCommand]
        >(AGENT_THREAD_UPDATE_NAME.RESOLVE_APPROVAL, {
          updateId,
          args: [command],
          startWorkflowOperation: startOperation,
        })
        return parseApprovalReceipt(value, command)
      } catch (error) {
        if (error instanceof WorkflowUpdateFailedError) throw error
        lastError = error
        if (!(error instanceof WorkflowExecutionAlreadyStartedError)) {
          continue
        }
        try {
          const value = await this.workflowClient
            .getHandle<AgentThreadCoordinatorWorkflow>(workflowId)
            .executeUpdate<
              AgentTurnApprovalDecisionReceipt,
              [ResolveAgentTurnApprovalCommand]
            >(AGENT_THREAD_UPDATE_NAME.RESOLVE_APPROVAL, {
              updateId,
              args: [command],
            })
          return parseApprovalReceipt(value, command)
        } catch (updateError) {
          if (updateError instanceof WorkflowUpdateFailedError) {
            throw updateError
          }
          lastError = updateError
        }
      }
    }
    throw new TemporalAgentTurnCommandUnconfirmedError(updateId, lastError)
  }

  async resolveChoice(
    command: ResolveAgentTurnChoiceCommand,
  ): Promise<AgentTurnAdmissionReceipt> {
    const workflowId = buildAgentThreadWorkflowId(command.threadId)
    const updateId = `agent-turn-choice:${hashCanonicalJson(command)}`
    let lastError: unknown = null
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const startOperation =
        new WithStartWorkflowOperation<AgentThreadCoordinatorWorkflow>(
          TEMPORAL_WORKFLOW_TYPE.AGENT_THREAD_COORDINATOR,
          {
            workflowId,
            workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
            workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
            taskQueue: this.taskQueue,
            args: [{ workflowId, threadId: command.threadId }],
          },
        )
      try {
        const value = await this.workflowClient.executeUpdateWithStart<
          AgentThreadCoordinatorWorkflow,
          unknown,
          [ResolveAgentTurnChoiceCommand]
        >(AGENT_THREAD_UPDATE_NAME.RESOLVE_CHOICE, {
          updateId,
          args: [command],
          startWorkflowOperation: startOperation,
        })
        return parseChoiceReceipt(value, { workflowId, command })
      } catch (error) {
        if (error instanceof WorkflowUpdateFailedError) throw error
        lastError = error
        if (!(error instanceof WorkflowExecutionAlreadyStartedError)) {
          continue
        }
        try {
          const value = await this.workflowClient
            .getHandle<AgentThreadCoordinatorWorkflow>(workflowId)
            .executeUpdate<
              AgentTurnAdmissionReceipt,
              [ResolveAgentTurnChoiceCommand]
            >(AGENT_THREAD_UPDATE_NAME.RESOLVE_CHOICE, {
              updateId,
              args: [command],
            })
          return parseChoiceReceipt(value, { workflowId, command })
        } catch (updateError) {
          if (updateError instanceof WorkflowUpdateFailedError) {
            throw updateError
          }
          lastError = updateError
        }
      }
    }
    throw new TemporalAgentTurnCommandUnconfirmedError(updateId, lastError)
  }

  async cancel(
    command: CancelAgentTurnCommand,
  ): Promise<AgentTurnCancellationReceipt> {
    const workflowId = buildAgentThreadWorkflowId(command.threadId)
    const updateId = `agent-turn-cancel:${hashCanonicalJson(command)}`
    let lastError: unknown = null
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const startOperation =
        new WithStartWorkflowOperation<AgentThreadCoordinatorWorkflow>(
          TEMPORAL_WORKFLOW_TYPE.AGENT_THREAD_COORDINATOR,
          {
            workflowId,
            workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
            workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
            taskQueue: this.taskQueue,
            args: [{ workflowId, threadId: command.threadId }],
          },
        )
      try {
        const value = await this.workflowClient.executeUpdateWithStart<
          AgentThreadCoordinatorWorkflow,
          unknown,
          [CancelAgentTurnCommand]
        >(AGENT_THREAD_UPDATE_NAME.CANCEL_TURN, {
          updateId,
          args: [command],
          startWorkflowOperation: startOperation,
        })
        return parseCancellationReceipt(value, command)
      } catch (error) {
        if (error instanceof WorkflowUpdateFailedError) throw error
        lastError = error
        if (!(error instanceof WorkflowExecutionAlreadyStartedError)) {
          continue
        }
        try {
          const value = await this.workflowClient
            .getHandle<AgentThreadCoordinatorWorkflow>(workflowId)
            .executeUpdate<
              AgentTurnCancellationReceipt,
              [CancelAgentTurnCommand]
            >(AGENT_THREAD_UPDATE_NAME.CANCEL_TURN, {
              updateId,
              args: [command],
            })
          return parseCancellationReceipt(value, command)
        } catch (updateError) {
          if (updateError instanceof WorkflowUpdateFailedError) {
            throw updateError
          }
          lastError = updateError
        }
      }
    }
    throw new TemporalAgentTurnCommandUnconfirmedError(updateId, lastError)
  }

  async clear(
    command: ClearAgentThreadCommand,
  ): Promise<AgentThreadClearReceipt> {
    const workflowId = buildAgentThreadWorkflowId(command.threadId)
    const updateId = `agent-thread-clear:${hashCanonicalJson(command)}`
    let lastError: unknown = null
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const startOperation =
        new WithStartWorkflowOperation<AgentThreadCoordinatorWorkflow>(
          TEMPORAL_WORKFLOW_TYPE.AGENT_THREAD_COORDINATOR,
          {
            workflowId,
            workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
            workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
            taskQueue: this.taskQueue,
            args: [{ workflowId, threadId: command.threadId }],
          },
        )
      try {
        const value = await this.workflowClient.executeUpdateWithStart<
          AgentThreadCoordinatorWorkflow,
          unknown,
          [ClearAgentThreadCommand]
        >(AGENT_THREAD_UPDATE_NAME.CLEAR_THREAD, {
          updateId,
          args: [command],
          startWorkflowOperation: startOperation,
        })
        return validateClearReceipt(value, command)
      } catch (error) {
        if (error instanceof WorkflowUpdateFailedError) throw error
        lastError = error
        if (!(error instanceof WorkflowExecutionAlreadyStartedError)) {
          continue
        }
        try {
          const value = await this.workflowClient
            .getHandle<AgentThreadCoordinatorWorkflow>(workflowId)
            .executeUpdate<AgentThreadClearReceipt, [ClearAgentThreadCommand]>(
              AGENT_THREAD_UPDATE_NAME.CLEAR_THREAD,
              {
                updateId,
                args: [command],
              },
            )
          return validateClearReceipt(value, command)
        } catch (updateError) {
          if (updateError instanceof WorkflowUpdateFailedError) {
            throw updateError
          }
          lastError = updateError
        }
      }
    }
    throw new TemporalAgentTurnCommandUnconfirmedError(updateId, lastError)
  }
}

function validateClearReceipt(
  value: unknown,
  command: ClearAgentThreadCommand,
): AgentThreadClearReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AGENT_THREAD_CLEAR_RECEIPT_INVALID')
  }
  const record = value as Record<string, unknown>
  if (
    record.protocol !== 'agent_thread_clear_receipt_v1' ||
    record.threadId !== command.threadId ||
    record.projectId !== command.projectId ||
    record.userId !== command.userId ||
    record.requestId !== command.requestId ||
    typeof record.archivedAt !== 'string' ||
    !record.archivedAt ||
    !Array.isArray(record.cancelledTurnIds) ||
    record.cancelledTurnIds.some(
      (turnId) => typeof turnId !== 'string' || !turnId,
    )
  ) {
    throw new Error('AGENT_THREAD_CLEAR_RECEIPT_DIVERGED')
  }
  return {
    protocol: 'agent_thread_clear_receipt_v1',
    threadId: command.threadId,
    projectId: command.projectId,
    userId: command.userId,
    requestId: command.requestId,
    archivedAt: record.archivedAt,
    cancelledTurnIds: record.cancelledTurnIds as string[],
  }
}

async function withTemporalAgentThreadClient<T>(
  commandId: string,
  invoke: (client: TemporalAgentThreadClient) => Promise<T>,
): Promise<T> {
  try {
    const [client, config] = await Promise.all([
      getTemporalClient(),
      Promise.resolve(getTemporalRuntimeConfig()),
    ])
    return await invoke(
      new TemporalAgentThreadClient(client.workflow, config.taskQueue),
    )
  } catch (error) {
    if (
      error instanceof WorkflowUpdateFailedError
      || error instanceof TemporalAgentTurnCommandConflictError
      || error instanceof TemporalAgentTurnCommandUnconfirmedError
    ) {
      throw error
    }
    throw new TemporalAgentTurnCommandUnconfirmedError(commandId, error)
  }
}

export async function submitAgentTurnViaTemporal(
  command: SubmitAgentTurnCommand,
): Promise<AgentTurnAdmissionReceipt> {
  const commandId = buildAgentTurnEnvelope(command).commandId
  return await withTemporalAgentThreadClient(
    commandId,
    async (client) => await client.submit(command),
  )
}

export async function resolveAgentTurnApprovalViaTemporal(
  command: ResolveAgentTurnApprovalCommand,
): Promise<AgentTurnApprovalDecisionReceipt> {
  const commandId = `agent-turn-approval:${hashCanonicalJson(command)}`
  return await withTemporalAgentThreadClient(
    commandId,
    async (client) => await client.resolveApproval(command),
  )
}

export async function resolveAgentTurnChoiceViaTemporal(
  command: ResolveAgentTurnChoiceCommand,
): Promise<AgentTurnAdmissionReceipt> {
  const commandId = `agent-turn-choice:${hashCanonicalJson(command)}`
  return await withTemporalAgentThreadClient(
    commandId,
    async (client) => await client.resolveChoice(command),
  )
}

export async function cancelAgentTurnViaTemporal(
  command: CancelAgentTurnCommand,
): Promise<AgentTurnCancellationReceipt> {
  const commandId = `agent-turn-cancel:${hashCanonicalJson(command)}`
  return await withTemporalAgentThreadClient(
    commandId,
    async (client) => await client.cancel(command),
  )
}

export async function clearAgentThreadViaTemporal(
  command: ClearAgentThreadCommand,
): Promise<AgentThreadClearReceipt> {
  const commandId = `agent-thread-clear:${hashCanonicalJson(command)}`
  return await withTemporalAgentThreadClient(
    commandId,
    async (client) => await client.clear(command),
  )
}
