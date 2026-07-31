export const AGENT_TURN_AGENTS_SDK_VERSION = '0.13.2' as const
export const AGENT_TURN_RUN_STATE_SCHEMA_VERSION = '1.13' as const
export const AGENT_TURN_AGENT_GRAPH_REVISION =
  'project-workspace-agent/v1' as const

export interface AgentTurnRuntimeContract {
  protocol: 'agent_turn_runtime_contract_v1'
  agentsSdkVersion: typeof AGENT_TURN_AGENTS_SDK_VERSION
  runStateSchemaVersion: typeof AGENT_TURN_RUN_STATE_SCHEMA_VERSION
  agentGraphRevision: typeof AGENT_TURN_AGENT_GRAPH_REVISION
}

export function buildAgentTurnRuntimeContract(): AgentTurnRuntimeContract {
  return {
    protocol: 'agent_turn_runtime_contract_v1',
    agentsSdkVersion: AGENT_TURN_AGENTS_SDK_VERSION,
    runStateSchemaVersion: AGENT_TURN_RUN_STATE_SCHEMA_VERSION,
    agentGraphRevision: AGENT_TURN_AGENT_GRAPH_REVISION,
  }
}

export function parseAgentTurnRuntimeContract(
  value: unknown,
): AgentTurnRuntimeContract {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AGENT_TURN_RUNTIME_CONTRACT_INVALID')
  }
  const record = value as Record<string, unknown>
  if (
    record.protocol !== 'agent_turn_runtime_contract_v1'
    || record.agentsSdkVersion !== AGENT_TURN_AGENTS_SDK_VERSION
    || record.runStateSchemaVersion !== AGENT_TURN_RUN_STATE_SCHEMA_VERSION
    || record.agentGraphRevision !== AGENT_TURN_AGENT_GRAPH_REVISION
  ) {
    throw new Error('AGENT_TURN_RUNTIME_CONTRACT_DIVERGED')
  }
  return buildAgentTurnRuntimeContract()
}

export function assertAgentTurnRunStateContract(params: {
  runState: string
  runtime: AgentTurnRuntimeContract
}): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(params.runState) as unknown
  } catch {
    throw new Error('AGENT_TURN_RUN_STATE_JSON_INVALID')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('AGENT_TURN_RUN_STATE_JSON_INVALID')
  }
  const schemaVersion = (parsed as Record<string, unknown>).$schemaVersion
  if (
    schemaVersion !== params.runtime.runStateSchemaVersion
    || params.runtime.agentsSdkVersion !== AGENT_TURN_AGENTS_SDK_VERSION
    || params.runtime.agentGraphRevision !== AGENT_TURN_AGENT_GRAPH_REVISION
  ) {
    throw new Error('AGENT_TURN_RUN_STATE_CONTRACT_DIVERGED')
  }
}
