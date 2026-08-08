import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowFailedError,
  WorkflowIdReusePolicy,
  type WorkflowClient,
} from '@temporalio/client'
import { AppError } from '@/lib/errors/app-error'
import { createFailureRecord } from '@/lib/errors/failure'
import { isTaskType } from '@/lib/task/types'
import { getTemporalClient } from '../client'
import { getTemporalRuntimeConfig } from '../config'
import { buildOperationExecutionWorkflowId } from '../identity'
import { decodeTemporalFailure } from '../failure'
import { TEMPORAL_WORKFLOW } from '../workflow-registry'
import {
  OPERATION_EXECUTION_MAX_TASKS,
  type OperationExecutionCommand,
  type OperationExecutionWorkflowInput as ExactOperationExecutionWorkflowInput,
  type OperationExecutionWorkflowReceipt as ExactOperationExecutionWorkflowReceipt,
} from './contracts'
import {
  buildOperationExecutionEnvelope,
} from './identity'

type OperationExecutionWorkflow = (
  input: ExactOperationExecutionWorkflowInput,
) => Promise<ExactOperationExecutionWorkflowReceipt>

export class TemporalOperationExecutionCommandUnconfirmedError extends Error {
  readonly code = 'TEMPORAL_OPERATION_EXECUTION_COMMAND_UNCONFIRMED'
  override readonly cause: unknown

  constructor(
    readonly commandId: string,
    readonly workflowId: string,
    cause: unknown,
  ) {
    super(
      `Temporal Operation execution acknowledgement is unconfirmed: ${commandId}`,
    )
    this.name = 'TemporalOperationExecutionCommandUnconfirmedError'
    this.cause = cause
  }
}

function operationWorkflowFailure(error: WorkflowFailedError): AppError {
  const failure = decodeTemporalFailure(error)
    ?? createFailureRecord('INTERNAL_ERROR', 'Temporal workflow failed without a canonical failure', {
      cause: error,
      context: { system: 'temporal', phase: 'operation-execution' },
      details: { reasonCode: 'TEMPORAL_FAILURE_PROTOCOL_MISSING' },
    })
  return AppError.fromFailure(failure, error)
}

function isScheduledState(
  value: unknown,
): value is ExactOperationExecutionWorkflowReceipt['tasks'][number]['schedule']['state'] {
  return (
    value === 'queued' ||
    value === 'running' ||
    value === 'notification_pending' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'canceled'
  )
}

function isSchedulerClass(
  value: unknown,
): value is ExactOperationExecutionWorkflowReceipt['tasks'][number]['schedule']['schedulerClass'] {
  return (
    value === null ||
    value === 'analysis' ||
    value === 'image' ||
    value === 'video'
  )
}

function parseReceipt(
  value: unknown,
  expected: {
    workflowId: string
    commandId: string
    payloadHash: string
    command: OperationExecutionCommand
  },
): ExactOperationExecutionWorkflowReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('OPERATION_EXECUTION_RECEIPT_INVALID')
  }
  const record = value as Record<string, unknown>
  if (
    record.workflowId !== expected.workflowId ||
    record.commandId !== expected.commandId ||
    record.payloadHash !== expected.payloadHash ||
    record.executionId !== expected.command.executionId ||
    typeof record.operationExecutionId !== 'string' ||
    !record.operationExecutionId ||
    record.operationRequestId !== expected.command.operationRequestId ||
    typeof record.outputHash !== 'string' ||
    !record.outputHash ||
    !Array.isArray(record.tasks) ||
    record.tasks.length > OPERATION_EXECUTION_MAX_TASKS
  ) {
    throw new Error('OPERATION_EXECUTION_REPLAY_DIVERGED')
  }
  const tasks = record.tasks.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('OPERATION_EXECUTION_TASK_RECEIPT_INVALID')
    }
    const task = item as Record<string, unknown>
    const referenceValue = task.reference
    const scheduleValue = task.schedule
    if (
      !referenceValue ||
      typeof referenceValue !== 'object' ||
      Array.isArray(referenceValue) ||
      !scheduleValue ||
      typeof scheduleValue !== 'object' ||
      Array.isArray(scheduleValue)
    ) {
      throw new Error('OPERATION_EXECUTION_TASK_RECEIPT_INVALID')
    }
    const reference = referenceValue as Record<string, unknown>
    const schedule = scheduleValue as Record<string, unknown>
    if (
      typeof reference.taskId !== 'string' ||
      !reference.taskId ||
      reference.userId !== expected.command.userId ||
      !isTaskType(reference.taskType) ||
      typeof schedule.enqueueId !== 'string' ||
      !schedule.enqueueId ||
      typeof schedule.taskWorkflowId !== 'string' ||
      !schedule.taskWorkflowId ||
      !isSchedulerClass(schedule.schedulerClass) ||
      !Number.isSafeInteger(schedule.sequence) ||
      (schedule.sequence as number) <= 0 ||
      !isScheduledState(schedule.state)
    ) {
      throw new Error('OPERATION_EXECUTION_TASK_RECEIPT_DIVERGED')
    }
    return {
      reference: {
        taskId: reference.taskId,
        userId: expected.command.userId,
        taskType: reference.taskType,
      },
      schedule: {
        enqueueId: schedule.enqueueId,
        taskWorkflowId: schedule.taskWorkflowId,
        schedulerClass: schedule.schedulerClass,
        sequence: schedule.sequence as number,
        state: schedule.state,
      },
    }
  })
  return {
    workflowId: expected.workflowId,
    commandId: expected.commandId,
    payloadHash: expected.payloadHash,
    executionId: expected.command.executionId,
    operationExecutionId: record.operationExecutionId,
    operationRequestId: expected.command.operationRequestId,
    outputHash: record.outputHash,
    tasks,
  }
}

export class TemporalOperationExecutionClient {
  constructor(
    private readonly workflowClient: WorkflowClient,
    private readonly taskQueue: string,
  ) {
    if (!taskQueue || taskQueue !== taskQueue.trim()) {
      throw new Error('TEMPORAL_TASK_QUEUE_INVALID')
    }
  }

  async execute(
    command: OperationExecutionCommand,
  ): Promise<ExactOperationExecutionWorkflowReceipt> {
    const envelope = buildOperationExecutionEnvelope(command)
    const workflowId = buildOperationExecutionWorkflowId(command.executionId)
    let result: unknown
    try {
      const handle = await this.workflowClient.start<OperationExecutionWorkflow>(
        TEMPORAL_WORKFLOW.OPERATION_EXECUTION.type,
        {
          workflowId,
          workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
          taskQueue: this.taskQueue,
          args: [
            {
              workflowId,
              envelope,
            },
          ],
        },
      )
      result = await handle.result()
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) {
        try {
          result = await this.workflowClient
            .getHandle<OperationExecutionWorkflow>(workflowId)
            .result()
        } catch (resultError) {
          if (resultError instanceof WorkflowFailedError) {
            throw operationWorkflowFailure(resultError)
          }
          throw new TemporalOperationExecutionCommandUnconfirmedError(
            envelope.commandId,
            workflowId,
            resultError,
          )
        }
      } else if (error instanceof WorkflowFailedError) {
        throw operationWorkflowFailure(error)
      } else {
        throw new TemporalOperationExecutionCommandUnconfirmedError(
          envelope.commandId,
          workflowId,
          error,
        )
      }
    }
    return parseReceipt(result, {
      workflowId,
      commandId: envelope.commandId,
      payloadHash: envelope.payloadHash,
      command,
    })
  }
}

export async function executeOperationViaTemporal(
  command: OperationExecutionCommand,
): Promise<ExactOperationExecutionWorkflowReceipt> {
  const envelope = buildOperationExecutionEnvelope(command)
  const workflowId = buildOperationExecutionWorkflowId(command.executionId)
  try {
    const [client, config] = await Promise.all([
      getTemporalClient(),
      Promise.resolve(getTemporalRuntimeConfig()),
    ])
    return await new TemporalOperationExecutionClient(
      client.workflow,
      config.taskQueue,
    ).execute(command)
  } catch (error) {
    if (
      error instanceof AppError ||
      error instanceof TemporalOperationExecutionCommandUnconfirmedError
    ) {
      throw error
    }
    throw new TemporalOperationExecutionCommandUnconfirmedError(
      envelope.commandId,
      workflowId,
      error,
    )
  }
}
