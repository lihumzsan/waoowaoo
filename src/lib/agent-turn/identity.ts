import { createHash } from 'node:crypto'
import { canonicalJson } from '@/lib/operation-plan-contract/canonical-json'
import {
  AGENT_TURN_PROTOCOL,
  AGENT_TURN_SOURCE_KIND,
  type AgentTurnCommandEnvelope,
  type AgentTurnSourceKind,
  type SubmitAgentTurnCommand,
} from './contracts'

const AGENT_TURN_MAX_CANONICAL_BYTES = 512 * 1_024

function fail(code: string, ...details: unknown[]): never {
  throw new Error(
    details.length > 0
      ? `${code}:${details.map(String).join(':')}`
      : code,
  )
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url')
}

function requireIdentity(
  value: unknown,
  code: string,
  maxLength = 191,
): string {
  if (
    typeof value !== 'string'
    || !value
    || value !== value.trim()
    || value.length > maxLength
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

function isSourceKind(value: unknown): value is AgentTurnSourceKind {
  return Object.values(AGENT_TURN_SOURCE_KIND).some(
    (candidate) => candidate === value,
  )
}

function assertSubmitAgentTurnCommand(
  command: SubmitAgentTurnCommand,
): void {
  if (!command || typeof command !== 'object' || Array.isArray(command)) {
    fail('AGENT_TURN_COMMAND_INVALID')
  }
  if (command.protocol !== AGENT_TURN_PROTOCOL) {
    fail('AGENT_TURN_PROTOCOL_INVALID')
  }
  requireIdentity(command.threadId, 'AGENT_THREAD_ID_INVALID')
  requireIdentity(command.projectId, 'AGENT_TURN_PROJECT_ID_INVALID')
  requireIdentity(command.userId, 'AGENT_TURN_USER_ID_INVALID')
  if (command.assistantId !== 'workspace-command') {
    fail('AGENT_TURN_ASSISTANT_ID_INVALID')
  }
  if (!isSourceKind(command.sourceKind)) {
    fail('AGENT_TURN_SOURCE_KIND_INVALID')
  }
  requireIdentity(command.sourceId, 'AGENT_TURN_SOURCE_ID_INVALID')
  requireIdentity(command.requestId, 'AGENT_TURN_REQUEST_ID_INVALID', 128)
  if (
    !command.context
    || typeof command.context !== 'object'
    || Array.isArray(command.context)
  ) {
    fail('AGENT_TURN_CONTEXT_INVALID')
  }
  requireNullableIdentity(
    command.context.locale,
    'AGENT_TURN_LOCALE_INVALID',
    16,
  )
  requireNullableIdentity(
    command.context.episodeId,
    'AGENT_TURN_EPISODE_ID_INVALID',
  )
  requireNullableIdentity(
    command.context.selectedScopeRef,
    'AGENT_TURN_SCOPE_REF_INVALID',
  )
  requireNullableIdentity(
    command.context.selectedAssetId,
    'AGENT_TURN_ASSET_ID_INVALID',
  )
  if (
    command.sourceKind === AGENT_TURN_SOURCE_KIND.USER
    && (!command.userMessage || command.userMessage.role !== 'user')
  ) {
    fail('AGENT_TURN_USER_MESSAGE_REQUIRED')
  }
  if (
    command.sourceKind !== AGENT_TURN_SOURCE_KIND.USER
    && command.userMessage !== null
  ) {
    fail('AGENT_TURN_USER_MESSAGE_FORBIDDEN')
  }
  const canonical = canonicalJson(command)
  if (
    Buffer.byteLength(canonical, 'utf8')
    > AGENT_TURN_MAX_CANONICAL_BYTES
  ) {
    fail('AGENT_TURN_COMMAND_TOO_LARGE')
  }
}

export function buildAgentTurnId(params: {
  threadId: string
  sourceKind: AgentTurnSourceKind
  sourceId: string
}): string {
  requireIdentity(params.threadId, 'AGENT_THREAD_ID_INVALID')
  if (!isSourceKind(params.sourceKind)) {
    fail('AGENT_TURN_SOURCE_KIND_INVALID')
  }
  requireIdentity(params.sourceId, 'AGENT_TURN_SOURCE_ID_INVALID')
  return `turn_${hash(canonicalJson([
    'agent-turn-v1',
    params.threadId,
    params.sourceKind,
    params.sourceId,
  ])).slice(0, 40)}`
}

export function buildAgentTurnEnvelope(
  command: SubmitAgentTurnCommand,
): AgentTurnCommandEnvelope {
  assertSubmitAgentTurnCommand(command)
  const canonical = canonicalJson(command)
  return {
    commandId: `agent-turn-command:v1:${hash(canonicalJson([
      command.threadId,
      command.sourceKind,
      command.sourceId,
    ]))}`,
    payloadHash: hash(canonical),
    command: structuredClone(command),
  }
}

export function assertAgentTurnEnvelope(
  envelope: AgentTurnCommandEnvelope,
): void {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    fail('AGENT_TURN_ENVELOPE_INVALID')
  }
  const expected = buildAgentTurnEnvelope(envelope.command)
  if (
    envelope.commandId !== expected.commandId
    || envelope.payloadHash !== expected.payloadHash
  ) {
    fail('AGENT_TURN_ENVELOPE_DIVERGED')
  }
}
