import { ApiError } from '@/lib/api-errors'
import { hashCanonicalJson } from '@/lib/operation-plan-contract/canonical-json'
import { prisma } from '@/lib/prisma'
import type { OperationExecutionCommand } from './contracts'
import { buildOperationExecutionEnvelope } from './identity'

/**
 * Loads the exact immutable output committed by the Operation transaction.
 *
 * The Temporal receipt authorizes this read but does not duplicate arbitrary
 * business output into Workflow history.
 */
export async function loadOperationExecutionOutput(params: {
  operationExecutionId: string
  command: OperationExecutionCommand
  outputHash: string
}): Promise<unknown> {
  const envelope = buildOperationExecutionEnvelope(params.command)
  const execution = await prisma.operationExecution.findUnique({
    where: { id: params.operationExecutionId },
    select: {
      id: true,
      userId: true,
      projectId: true,
      operationId: true,
      executionKind: true,
      commandId: true,
      payloadHash: true,
      approvalGrantId: true,
      requestId: true,
      status: true,
      output: true,
    },
  })
  if (
    !execution
    || execution.id !== params.operationExecutionId
    || execution.userId !== params.command.userId
    || execution.projectId !== params.command.projectId
    || execution.operationId !== params.command.operationId
    || (
      params.command.kind === 'approved_plan'
        ? execution.approvalGrantId !== params.command.approvalGrantId
        : execution.approvalGrantId !== null
          || execution.executionKind !== 'direct_task'
          || execution.commandId !== envelope.commandId
          || execution.payloadHash !== envelope.payloadHash
    )
    || execution.requestId !== params.command.operationRequestId
    || execution.status !== 'completed'
    || execution.output === null
    || hashCanonicalJson(execution.output) !== params.outputHash
  ) {
    throw new ApiError('EXTERNAL_ERROR', {
      code: 'OPERATION_EXECUTION_OUTPUT_DIVERGED',
      message:
        'completed operation output does not match the Temporal receipt',
    })
  }
  return execution.output
}
