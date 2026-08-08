import { ApplicationFailure, Context, heartbeat } from '@temporalio/activity'
import { WorkflowUpdateFailedError } from '@temporalio/client'
import { normalizeAnyError } from '@/lib/errors/normalize'
import { hashCanonicalJson } from '@/lib/operation-plan-contract/canonical-json'
import { createAgentFollowUpBatchBinding } from '@/lib/agent-turn/follow-up-batch'
import { assertOperationChannelAllowed } from '@/lib/operations/channel-policy'
import { executeDirectOperationTransaction } from '@/lib/operations/durable-execution'
import { invokeProjectAgentOperation } from '@/lib/operations/invocation'
import {
  ApprovedOperationExecutionReceiptError,
  invokeApprovedOperationPlanWithReceipt,
  loadApprovedOperationExecutionInput,
} from '@/lib/operations/planned-operation-invocation'
import { loadOperationPlanSnapshot } from '@/lib/operations/operation-plan-snapshot'
import { createProjectAgentOperationRegistryForApi } from '@/lib/operations/registry'
import {
  isBillablePlannedOperation,
  type ProjectAgentOperationContext,
} from '@/lib/operations/types'
import { prisma } from '@/lib/prisma'
import { getTaskDefinition } from '@/lib/task/definition'
import { publishPersistedTaskEventById } from '@/lib/task/publisher'
import { isTaskType } from '@/lib/task/types'
import { buildOperationExecutionWorkflowId, buildTaskWorkflowId } from '@/lib/temporal/identity'
import {
  encodeTemporalFailure,
  temporalInvariantFailure,
} from '@/lib/temporal/failure'
import type { FailureRecord } from '@/lib/errors/failure'
import {
  OPERATION_EXECUTION_MAX_TASKS,
  type DirectTaskOperationExecutionCommand,
  type ExecuteOperationActivityInput,
  type OperationExecutionCommandEnvelope,
  type OperationExecutionWorkflowReceipt,
} from '../operation-execution/contracts'
import { assertOperationExecutionEnvelope } from '../operation-execution/identity'
import { schedulePersistedTask, TemporalTaskCommandUnconfirmedError } from '../task-client'

function failNonRetryable(code: string, ...details: unknown[]): never {
  throwFailureNonRetryable(temporalInvariantFailure(code, details))
}

function throwFailureNonRetryable(failure: FailureRecord): never {
  const encoded = encodeTemporalFailure(failure)
  throw ApplicationFailure.nonRetryable(
    encoded.message,
    encoded.type,
    ...encoded.details,
  )
}

function deterministicScheduleFailure(error: unknown): string | null {
  if (error instanceof ApprovedOperationExecutionReceiptError) {
    return error.code
  }
  if (error instanceof WorkflowUpdateFailedError) {
    return 'OPERATION_EXECUTION_TASK_SCHEDULE_REJECTED'
  }
  if (
    error instanceof Error &&
    (error.message.startsWith('TASK_SCHEDULE_RECEIPT_') ||
      error.message.startsWith('TASK_TYPE_INVALID:') ||
      error.message === 'TASK_ID_INVALID' ||
      error.message === 'TASK_USER_ID_INVALID')
  ) {
    return error.message
  }
  return null
}

function throwByOperationExecutionRetryPolicy(error: unknown): never {
  const deterministicCode = deterministicScheduleFailure(error)
  if (deterministicCode) return failNonRetryable(deterministicCode)
  if (error instanceof TemporalTaskCommandUnconfirmedError) throw error
  const failure = normalizeAnyError(error, {
    context: { system: 'temporal', phase: 'operation-execution' },
  })
  return throwFailureNonRetryable(failure)
}

function requireActivityIdentity(input: ExecuteOperationActivityInput): void {
  const expectedWorkflowId = buildOperationExecutionWorkflowId(input.envelope.command.executionId)
  if (input.workflowId !== expectedWorkflowId) {
    failNonRetryable(
      'OPERATION_EXECUTION_WORKFLOW_ID_DIVERGED',
      input.workflowId,
      expectedWorkflowId,
    )
  }
  const activityWorkflowId = Context.current().info.workflowExecution?.workflowId
  if (!activityWorkflowId || activityWorkflowId !== input.workflowId) {
    failNonRetryable(
      'OPERATION_EXECUTION_ACTIVITY_WORKFLOW_DIVERGED',
      activityWorkflowId ?? null,
      input.workflowId,
    )
  }
}

function validateReceipt(
  input: ExecuteOperationActivityInput,
  receipt: OperationExecutionWorkflowReceipt,
): OperationExecutionWorkflowReceipt {
  const command = input.envelope.command
  if (
    receipt.workflowId !== input.workflowId ||
    receipt.commandId !== input.envelope.commandId ||
    receipt.payloadHash !== input.envelope.payloadHash ||
    receipt.executionId !== command.executionId ||
    receipt.operationRequestId !== command.operationRequestId ||
    !receipt.operationExecutionId ||
    !receipt.outputHash ||
    receipt.tasks.length > OPERATION_EXECUTION_MAX_TASKS
  ) {
    return failNonRetryable('OPERATION_EXECUTION_RECEIPT_DIVERGED')
  }
  const taskIds = new Set<string>()
  const enqueueIds = new Set<string>()
  for (const task of receipt.tasks) {
    const taskType = task.reference.taskType
    if (
      task.reference.userId !== command.userId ||
      !task.reference.taskId ||
      !isTaskType(taskType) ||
      taskIds.has(task.reference.taskId) ||
      task.schedule.taskWorkflowId !== buildTaskWorkflowId(task.reference.taskId) ||
      !task.schedule.enqueueId ||
      enqueueIds.has(task.schedule.enqueueId) ||
      task.schedule.schedulerClass !== getTaskDefinition(taskType).schedulerClass ||
      !Number.isSafeInteger(task.schedule.sequence) ||
      task.schedule.sequence <= 0 ||
      (task.schedule.state !== 'queued' &&
        task.schedule.state !== 'running' &&
        task.schedule.state !== 'notification_pending' &&
        task.schedule.state !== 'completed' &&
        task.schedule.state !== 'failed' &&
        task.schedule.state !== 'canceled')
    ) {
      return failNonRetryable('OPERATION_EXECUTION_TASK_SCHEDULE_DIVERGED', task.reference.taskId)
    }
    taskIds.add(task.reference.taskId)
    enqueueIds.add(task.schedule.enqueueId)
  }
  return {
    ...receipt,
    tasks: receipt.tasks.map((task) => ({
      reference: { ...task.reference },
      schedule: { ...task.schedule },
    })),
  }
}

async function executeApprovedPlanOperation(
  input: ExecuteOperationActivityInput,
): Promise<OperationExecutionWorkflowReceipt> {
  if (input.envelope.command.kind !== 'approved_plan') {
    return failNonRetryable('OPERATION_EXECUTION_KIND_INVALID')
  }
  const command = input.envelope.command
  const operation = createProjectAgentOperationRegistryForApi()[command.operationId]
  if (!operation) {
    return failNonRetryable('OPERATION_EXECUTION_OPERATION_NOT_REGISTERED', command.operationId)
  }
  try {
    assertOperationChannelAllowed(operation, 'api')
  } catch (error) {
    return failNonRetryable(
      error instanceof Error ? error.message : 'OPERATION_EXECUTION_API_CHANNEL_FORBIDDEN',
      command.operationId,
    )
  }
  if (!isBillablePlannedOperation(operation)) {
    return failNonRetryable('OPERATION_EXECUTION_BILLABLE_PLAN_REQUIRED', command.operationId)
  }

  const invocation = {
    approvalGrantId: command.approvalGrantId,
    requestId: command.operationRequestId,
  }
  let normalizedInput: unknown
  try {
    normalizedInput = await loadApprovedOperationExecutionInput({
      userId: command.userId,
      operationId: command.operationId,
      invocation,
    })
  } catch (error) {
    return throwByOperationExecutionRetryPolicy(error)
  }
  const parsedInput = operation.inputSchema.safeParse(normalizedInput)
  if (!parsedInput.success) {
    return failNonRetryable('OPERATION_EXECUTION_FROZEN_INPUT_INVALID', command.operationId)
  }
  const grant = await prisma.approvalGrant.findUnique({
    where: { id: command.approvalGrantId },
    select: {
      projectId: true,
      planSnapshotId: true,
    },
  })
  if (
    !grant ||
    grant.projectId !== command.projectId
  ) {
    return failNonRetryable('OPERATION_EXECUTION_PROJECT_SCOPE_DIVERGED', command.approvalGrantId)
  }
  const snapshot = await loadOperationPlanSnapshot(grant.planSnapshotId)
  if (!snapshot) {
    return failNonRetryable('OPERATION_EXECUTION_PLAN_SNAPSHOT_MISSING', grant.planSnapshotId)
  }
  const locales = new Set(snapshot.plan.tasks.map((task) => task.locale))
  if (locales.size > 1) {
    return failNonRetryable('OPERATION_EXECUTION_PLAN_LOCALE_DIVERGED', grant.planSnapshotId)
  }
  const locale = [...locales][0]
  const followUpBatchBinding =
    command.context.origin.kind === 'agent_turn'
      ? createAgentFollowUpBatchBinding({
          executionKey: command.executionId,
          turnId: command.context.origin.turnId,
          callId: command.context.origin.callId,
          operationId: command.operationId,
        })
      : null
  const context: ProjectAgentOperationContext = {
    request: null,
    requestId: command.operationRequestId,
    signal: Context.current().cancellationSignal,
    userId: command.userId,
    projectId: command.projectId,
    context: {
      ...(locale ? { locale } : {}),
      selectedScopeRef: command.context.selectedScopeRef,
      selectedAssetId: command.context.selectedAssetId,
      ...(command.context.origin.kind === 'agent_turn'
        ? { turnId: command.context.origin.turnId }
        : {}),
    },
    invocationChannel: 'api',
    source: command.source,
    writer: null,
    toolCallId: command.context.origin.kind === 'agent_turn' ? command.context.origin.callId : null,
    activityId: Context.current().info.activityId,
    followUpBatchBinding,
  }
  try {
    const result = await invokeApprovedOperationPlanWithReceipt({
      operation,
      ctx: context,
      normalizedInput: parsedInput.data,
      invocation,
    })
    return validateReceipt(input, {
      workflowId: input.workflowId,
      commandId: input.envelope.commandId,
      payloadHash: input.envelope.payloadHash,
      executionId: command.executionId,
      ...result.receipt,
    })
  } catch (error) {
    return throwByOperationExecutionRetryPolicy(error)
  }
}

async function directTaskReceipt(params: {
  input: ExecuteOperationActivityInput
  command: DirectTaskOperationExecutionCommand
  operationExecutionId: string
  output: unknown
}): Promise<OperationExecutionWorkflowReceipt> {
  const tasks = await prisma.task.findMany({
    where: { operationExecutionId: params.operationExecutionId },
    orderBy: { id: 'asc' },
  })
  if (tasks.length === 0 || tasks.length > OPERATION_EXECUTION_MAX_TASKS) {
    return failNonRetryable(
      'OPERATION_EXECUTION_TASK_BATCH_DIVERGED',
      params.operationExecutionId,
      tasks.length,
    )
  }
  const references = []
  for (const task of tasks) {
    if (
      task.userId !== params.command.userId ||
      task.projectId !== params.command.projectId ||
      task.operationId !== params.command.operationId ||
      task.operationExecutionId !== params.operationExecutionId ||
      task.operationRequestId !== params.command.operationRequestId ||
      task.approvalGrantId !== null ||
      !isTaskType(task.type)
    ) {
      return failNonRetryable(
        'OPERATION_EXECUTION_TASK_RECEIPT_DIVERGED',
        params.operationExecutionId,
        task.id,
      )
    }
    references.push({
      taskId: task.id,
      userId: task.userId,
      taskType: task.type,
    })
  }
  const scheduled = []
  for (const reference of references) {
    scheduled.push({
      reference,
      schedule: await schedulePersistedTask(reference),
    })
  }
  return validateReceipt(params.input, {
    workflowId: params.input.workflowId,
    commandId: params.input.envelope.commandId,
    payloadHash: params.input.envelope.payloadHash,
    executionId: params.command.executionId,
    operationExecutionId: params.operationExecutionId,
    operationRequestId: params.command.operationRequestId,
    outputHash: hashCanonicalJson(params.output),
    tasks: scheduled,
  })
}

async function executeDirectTaskOperation(
  input: ExecuteOperationActivityInput,
): Promise<OperationExecutionWorkflowReceipt> {
  if (input.envelope.command.kind !== 'direct_task') {
    return failNonRetryable('OPERATION_EXECUTION_KIND_INVALID')
  }
  const command = input.envelope.command
  const envelope = input.envelope as OperationExecutionCommandEnvelope & {
    command: DirectTaskOperationExecutionCommand
  }
  const registry = createProjectAgentOperationRegistryForApi()
  const operation = registry[command.operationId]
  if (!operation) {
    return failNonRetryable('OPERATION_EXECUTION_OPERATION_NOT_REGISTERED', command.operationId)
  }
  try {
    assertOperationChannelAllowed(operation, command.channel)
  } catch (error) {
    return failNonRetryable(
      error instanceof Error ? error.message : 'OPERATION_EXECUTION_CHANNEL_FORBIDDEN',
      command.operationId,
    )
  }
  const authority = operation.assistantWriteAuthority
  if (
    authority?.kind !== 'temporal_operation_execution' ||
    authority.contractRevision !== command.executionContractRevision ||
    authority.followUpPolicy !== 'after_all_terminal'
  ) {
    return failNonRetryable('OPERATION_EXECUTION_REGISTRY_CONTRACT_DIVERGED', command.operationId)
  }
  const parsedInput = operation.inputSchema.safeParse(command.normalizedInput)
  if (
    !parsedInput.success ||
    hashCanonicalJson(parsedInput.data) !== hashCanonicalJson(command.normalizedInput)
  ) {
    return failNonRetryable('OPERATION_EXECUTION_FROZEN_INPUT_INVALID', command.operationId)
  }

  try {
    const followUpBatchBinding =
      command.context.origin.kind === 'agent_turn'
        ? createAgentFollowUpBatchBinding({
            executionKey: command.executionId,
            turnId: command.context.origin.turnId,
            callId: command.context.origin.callId,
            operationId: command.operationId,
          })
        : null
    const state = await executeDirectOperationTransaction({
      envelope,
      execute: async (transaction, operationExecutionId) => {
        const context: ProjectAgentOperationContext = {
          request: null,
          requestId: command.operationRequestId,
          signal: Context.current().cancellationSignal,
          userId: command.userId,
          projectId: command.projectId,
          context: {
            ...(command.context.locale ? { locale: command.context.locale } : {}),
            selectedScopeRef: command.context.selectedScopeRef,
            selectedAssetId: command.context.selectedAssetId,
            ...(command.context.origin.kind === 'agent_turn'
              ? { turnId: command.context.origin.turnId }
              : {}),
          },
          invocationChannel: command.channel,
          source: command.source,
          writer: null,
          toolCallId:
            command.context.origin.kind === 'agent_turn' ? command.context.origin.callId : null,
          activityId: Context.current().info.activityId,
          operationExecutionId,
          operationExecutionTransaction: transaction,
          followUpBatchBinding,
        }
        const result = await invokeProjectAgentOperation({
          registry,
          channel: command.channel,
          operationId: command.operationId,
          context,
          input: parsedInput.data,
          invocationMode: 'durable_operation_execution',
        })
        if (result.kind !== 'executed') {
          return failNonRetryable('OPERATION_EXECUTION_DIRECT_RESULT_INVALID', command.operationId)
        }
        if (command.context.origin.kind === 'agent_turn' && !followUpBatchBinding?.isBound()) {
          return failNonRetryable(
            'OPERATION_EXECUTION_FOLLOW_UP_BATCH_MISSING',
            command.operationId,
          )
        }
        return result.data
      },
    })
    if (state.output === null || state.output === undefined) {
      return failNonRetryable('OPERATION_EXECUTION_OUTPUT_MISSING', command.operationId)
    }
    return await directTaskReceipt({
      input,
      command,
      operationExecutionId: state.operationExecutionId,
      output: state.output,
    })
  } catch (error) {
    return throwByOperationExecutionRetryPolicy(error)
  }
}

export async function executeOperation(
  input: ExecuteOperationActivityInput,
): Promise<OperationExecutionWorkflowReceipt> {
  try {
    assertOperationExecutionEnvelope(input.envelope)
    requireActivityIdentity(input)
  } catch (error) {
    return failNonRetryable(
      error instanceof Error ? error.message : 'OPERATION_EXECUTION_COMMAND_INVALID',
    )
  }
  heartbeat({ phase: 'operation-execution', version: 1 })
  const heartbeatTimer = setInterval(() => {
    heartbeat({ phase: 'operation-execution', version: 1 })
  }, 5_000)
  heartbeatTimer.unref()
  try {
    const receipt =
      input.envelope.command.kind === 'approved_plan'
        ? await executeApprovedPlanOperation(input)
        : await executeDirectTaskOperation(input)
    for (const task of receipt.tasks) {
      const event = await prisma.taskEvent.findUnique({
        where: { idempotencyKey: `task-created:${task.reference.taskId}` },
        select: { id: true },
      })
      if (!event) {
        return failNonRetryable(
          'OPERATION_EXECUTION_TASK_CREATED_EVENT_MISSING',
          task.reference.taskId,
        )
      }
      try {
        await publishPersistedTaskEventById(event.id, task.reference.taskId)
      } catch (error) {
        // TaskEvent is durable and replayed by SSE bootstrap. Live delivery is
        // only a latency optimization and must never change execution facts.
        Context.current().log.warn(
          'task created event live publication failed; durable replay remains authoritative',
          {
            taskId: task.reference.taskId,
            eventId: event.id,
            error: error instanceof Error ? error.message : String(error),
          },
        )
      }
    }
    // Task-producing Operations do not emit a synchronous mutation receipt.
    // Their pending Task is projected by the durable Created TaskEvent, and
    // their authoritative changed resource refs are committed by Task terminal
    // materialization. Applying the synchronous transaction projector here
    // would create a second resource-impact interpretation.
    return receipt
  } finally {
    clearInterval(heartbeatTimer)
  }
}
