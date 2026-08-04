import { createHash } from 'node:crypto'
import { canonicalJson } from '@/lib/operation-plan-contract/canonical-json'
import {
  OPERATION_EXECUTION_MAX_CANONICAL_BYTES,
  OPERATION_EXECUTION_MAX_SOURCE_LENGTH,
  OPERATION_EXECUTION_PROTOCOL,
  type OperationExecutionCommand,
  type OperationExecutionCommandEnvelope,
} from './contracts'

const APPROVED_COMMAND_KEYS = [
  'approvalGrantId',
  'context',
  'executionId',
  'kind',
  'operationId',
  'operationRequestId',
  'projectId',
  'protocol',
  'source',
  'userId',
] as const

const DIRECT_COMMAND_KEYS = [
  'channel',
  'context',
  'executionContractRevision',
  'executionId',
  'kind',
  'normalizedInput',
  'operationId',
  'operationRequestId',
  'projectId',
  'protocol',
  'source',
  'userId',
] as const

const DIRECT_CONTEXT_KEYS = [
  'locale',
  'origin',
  'selectedAssetId',
  'selectedScopeRef',
] as const

function fail(code: string, ...details: unknown[]): never {
  throw new Error(
    details.length > 0 ? `${code}:${details.map(String).join(':')}` : code,
  )
}

function requireIdentity(
  value: unknown,
  code: string,
  maxLength = 191,
): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value !== value.trim() ||
    value.length > maxLength
  ) {
    return fail(code)
  }
  return value
}

function requireNullableIdentity(
  value: unknown,
  code: string,
  maxLength = 191,
): void {
  if (value === null) return
  requireIdentity(value, code, maxLength)
}

function requireExactKeys(
  value: object,
  allowed: readonly string[],
  code: string,
): void {
  const allowedSet = new Set(allowed)
  const unexpected = Object.keys(value)
    .filter((key) => !allowedSet.has(key))
    .sort()
  if (unexpected.length > 0) fail(code, unexpected.join(','))
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url')
}

export function assertOperationExecutionCommand(
  command: OperationExecutionCommand,
): void {
  if (!command || typeof command !== 'object' || Array.isArray(command)) {
    fail('OPERATION_EXECUTION_COMMAND_INVALID')
  }
  if (command.protocol !== OPERATION_EXECUTION_PROTOCOL) {
    fail('OPERATION_EXECUTION_PROTOCOL_INVALID')
  }
  requireIdentity(command.executionId, 'OPERATION_EXECUTION_ID_INVALID')
  requireIdentity(command.userId, 'OPERATION_EXECUTION_USER_ID_INVALID')
  requireIdentity(command.projectId, 'OPERATION_EXECUTION_PROJECT_ID_INVALID')
  requireIdentity(
    command.operationId,
    'OPERATION_EXECUTION_OPERATION_ID_INVALID',
    128,
  )
  requireIdentity(
    command.operationRequestId,
    'OPERATION_EXECUTION_REQUEST_ID_INVALID',
    128,
  )
  requireIdentity(
    command.source,
    'OPERATION_EXECUTION_SOURCE_INVALID',
    OPERATION_EXECUTION_MAX_SOURCE_LENGTH,
  )
  if (command.kind === 'approved_plan') {
    requireExactKeys(
      command,
      APPROVED_COMMAND_KEYS,
      'OPERATION_EXECUTION_COMMAND_FIELD_UNKNOWN',
    )
    requireIdentity(
      command.approvalGrantId,
      'OPERATION_EXECUTION_APPROVAL_GRANT_ID_INVALID',
    )
    if (command.executionId !== command.approvalGrantId) {
      fail('OPERATION_EXECUTION_APPROVAL_IDENTITY_DIVERGED')
    }
  } else if (command.kind !== 'direct_task') {
    fail('OPERATION_EXECUTION_KIND_INVALID')
  } else {
    requireExactKeys(
      command,
      DIRECT_COMMAND_KEYS,
      'OPERATION_EXECUTION_COMMAND_FIELD_UNKNOWN',
    )
    if (command.channel !== 'tool' && command.channel !== 'api') {
      fail('OPERATION_EXECUTION_CHANNEL_INVALID')
    }
    requireIdentity(
      command.executionContractRevision,
      'OPERATION_EXECUTION_CONTRACT_REVISION_INVALID',
      128,
    )
  }
  if (
    !command.context ||
    typeof command.context !== 'object' ||
    Array.isArray(command.context)
  ) {
    fail('OPERATION_EXECUTION_CONTEXT_INVALID')
  }
  requireExactKeys(
    command.context,
    DIRECT_CONTEXT_KEYS,
    'OPERATION_EXECUTION_CONTEXT_FIELD_UNKNOWN',
  )
  for (const [value, code] of [
    [command.context.locale, 'OPERATION_EXECUTION_LOCALE_INVALID'],
    [command.context.selectedScopeRef, 'OPERATION_EXECUTION_SCOPE_REF_INVALID'],
    [command.context.selectedAssetId, 'OPERATION_EXECUTION_ASSET_ID_INVALID'],
  ] as const) {
    requireNullableIdentity(value, code)
  }
  const origin = command.context.origin
  if (!origin || typeof origin !== 'object' || Array.isArray(origin)) {
    fail('OPERATION_EXECUTION_ORIGIN_INVALID')
  }
  if (origin.kind === 'agent_turn') {
    requireExactKeys(
      origin,
      ['callId', 'kind', 'turnId'],
      'OPERATION_EXECUTION_ORIGIN_FIELD_UNKNOWN',
    )
    requireIdentity(origin.turnId, 'OPERATION_EXECUTION_TURN_ID_INVALID')
    requireIdentity(origin.callId, 'OPERATION_EXECUTION_CALL_ID_INVALID')
    if (command.kind === 'direct_task' && command.channel !== 'tool') {
      fail('OPERATION_EXECUTION_ORIGIN_CHANNEL_DIVERGED')
    }
  } else if (origin.kind === 'api') {
    requireExactKeys(
      origin,
      ['kind'],
      'OPERATION_EXECUTION_ORIGIN_FIELD_UNKNOWN',
    )
    if (command.kind === 'direct_task' && command.channel !== 'api') {
      fail('OPERATION_EXECUTION_ORIGIN_CHANNEL_DIVERGED')
    }
  } else {
    fail('OPERATION_EXECUTION_ORIGIN_KIND_INVALID')
  }
  if (
    command.kind === 'direct_task' &&
    canonicalJson(command.normalizedInput) === undefined
  ) {
    fail('OPERATION_EXECUTION_INPUT_NOT_JSON')
  }
}

function canonicalCommand(command: OperationExecutionCommand): string {
  assertOperationExecutionCommand(command)
  const canonical = canonicalJson(command)
  if (
    Buffer.byteLength(canonical, 'utf8') >
    OPERATION_EXECUTION_MAX_CANONICAL_BYTES
  ) {
    return fail('OPERATION_EXECUTION_COMMAND_TOO_LARGE')
  }
  return canonical
}

export function buildOperationExecutionCommandId(
  command: OperationExecutionCommand,
): string {
  assertOperationExecutionCommand(command)
  return `operation-command:v1:${hash(
    JSON.stringify([
      command.kind,
      command.executionId,
      command.operationRequestId,
    ]),
  )}`
}

export function buildOperationExecutionEnvelope(
  command: OperationExecutionCommand,
): OperationExecutionCommandEnvelope {
  const commandCopy: OperationExecutionCommand = {
    ...command,
    context: {
      ...command.context,
      origin: { ...command.context.origin },
    },
  }
  return {
    commandId: buildOperationExecutionCommandId(command),
    payloadHash: hash(canonicalCommand(command)),
    command: commandCopy,
  }
}

export function assertOperationExecutionEnvelope(
  envelope: OperationExecutionCommandEnvelope,
): void {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    fail('OPERATION_EXECUTION_ENVELOPE_INVALID')
  }
  requireExactKeys(
    envelope,
    ['command', 'commandId', 'payloadHash'],
    'OPERATION_EXECUTION_ENVELOPE_FIELD_UNKNOWN',
  )
  const expected = buildOperationExecutionEnvelope(envelope.command)
  if (
    envelope.commandId !== expected.commandId ||
    envelope.payloadHash !== expected.payloadHash
  ) {
    fail('OPERATION_EXECUTION_ENVELOPE_DIVERGED')
  }
}
