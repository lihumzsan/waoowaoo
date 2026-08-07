import {
  ApplicationFailure,
  proxyActivities,
  setWorkflowOptions,
  workflowInfo,
} from '@temporalio/workflow'
import {
  encodeTemporalFailure,
  temporalInvariantFailure,
} from '../failure'
import {
  OPERATION_EXECUTION_PROTOCOL,
  type OperationExecutionActivities,
  type OperationExecutionWorkflowInput,
  type OperationExecutionWorkflowReceipt,
} from '../operation-execution/contracts'
import { TEMPORAL_WORKFLOW } from '../workflow-registry'

const activities = proxyActivities<OperationExecutionActivities>({
  startToCloseTimeout: '3 minutes',
  heartbeatTimeout: '15 seconds',
  retry: {
    initialInterval: '500 milliseconds',
    backoffCoefficient: 2,
    maximumInterval: '30 seconds',
  },
})

function fail(code: string, ...details: unknown[]): never {
  const encoded = encodeTemporalFailure(temporalInvariantFailure(code, details))
  throw ApplicationFailure.nonRetryable(
    encoded.message,
    encoded.type,
    ...encoded.details,
  )
}

function requireIdentity(value: unknown, code: string): void {
  if (
    typeof value !== 'string'
    || !value
    || value !== value.trim()
  ) {
    fail(code)
  }
}

function validateWorkflowEnvelope(
  input: OperationExecutionWorkflowInput,
): void {
  const envelope = input.envelope
  if (
    !envelope
    || typeof envelope !== 'object'
    || !envelope.command
    || typeof envelope.command !== 'object'
  ) {
    fail('OPERATION_EXECUTION_ENVELOPE_INVALID')
  }
  requireIdentity(
    envelope.commandId,
    'OPERATION_EXECUTION_COMMAND_ID_INVALID',
  )
  requireIdentity(
    envelope.payloadHash,
    'OPERATION_EXECUTION_PAYLOAD_HASH_INVALID',
  )
  if (envelope.command.protocol !== OPERATION_EXECUTION_PROTOCOL) {
    fail('OPERATION_EXECUTION_PROTOCOL_INVALID')
  }
  for (const [value, code] of [
    [envelope.command.executionId, 'OPERATION_EXECUTION_ID_INVALID'],
    [envelope.command.userId, 'OPERATION_EXECUTION_USER_ID_INVALID'],
    [envelope.command.projectId, 'OPERATION_EXECUTION_PROJECT_ID_INVALID'],
    [envelope.command.operationId, 'OPERATION_EXECUTION_OPERATION_ID_INVALID'],
    [
      envelope.command.operationRequestId,
      'OPERATION_EXECUTION_REQUEST_ID_INVALID',
    ],
    [envelope.command.source, 'OPERATION_EXECUTION_SOURCE_INVALID'],
  ] as const) {
    requireIdentity(value, code)
  }
}

/**
 * Durable owner for exactly one task-producing Operation command.
 *
 * The immutable command is the Workflow input. This is deliberately not an
 * Update-With-Start state machine: one execution identity can accept exactly
 * one command, and Workflow ID reuse plus the MySQL execution record provide
 * exact replay after an acknowledgement loss.
 */
export async function operationExecutionWorkflow(
  input: OperationExecutionWorkflowInput,
): Promise<OperationExecutionWorkflowReceipt> {
  if (!input || typeof input !== 'object') {
    fail('OPERATION_EXECUTION_WORKFLOW_INPUT_INVALID')
  }
  requireIdentity(
    input.workflowId,
    'OPERATION_EXECUTION_WORKFLOW_ID_INVALID',
  )
  if (workflowInfo().workflowId !== input.workflowId) {
    fail(
      'OPERATION_EXECUTION_WORKFLOW_ID_DIVERGED',
      workflowInfo().workflowId,
      input.workflowId,
    )
  }
  validateWorkflowEnvelope(input)
  return await activities.executeOperation({
    workflowId: input.workflowId,
    envelope: input.envelope,
  })
}

setWorkflowOptions(
  { versioningBehavior: TEMPORAL_WORKFLOW.OPERATION_EXECUTION.versioningBehavior },
  operationExecutionWorkflow,
)
