import { createProjectAgentOperationRegistry as createRawProjectAgentOperationRegistry } from './project-agent'
import { createApiOnlyOperationRegistry } from './api-only'
import { isEditFirstAutoApprovedOperationId } from '@/lib/project-workflow/edit-first-operation-policy'
export type {
  ProjectAgentOperationContext,
  ProjectAgentOperationDefinition,
  ProjectAgentOperationRegistry,
} from './types'

function mustTrimmedString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`PROJECT_AGENT_OPERATION_${label}_INVALID`)
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`PROJECT_AGENT_OPERATION_${label}_EMPTY`)
  return trimmed
}

function requiresConfirmationByEffects(effects: {
  billable: boolean
  destructive: boolean
  overwrite: boolean
  bulk: boolean
  externalSideEffects: boolean
  longRunning: boolean
}): boolean {
  return (
    effects.billable
    || effects.destructive
    || effects.overwrite
    || effects.bulk
    || effects.externalSideEffects
    || effects.longRunning
  )
}

function isToolConfirmationExemptOperationId(operationId: string): boolean {
  return (
    isEditFirstAutoApprovedOperationId(operationId)
    || operationId === 'generate_project_music'
    || operationId === 'generate_episode_bgm_score'
    || operationId === 'generate_episode_soundscape'
  )
}

function validateOperationRegistry(registry: Record<string, unknown>) {
  for (const [operationId, operation] of Object.entries(registry)) {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
      throw new Error(`PROJECT_AGENT_OPERATION_INVALID:${operationId}`)
    }
    const op = operation as Record<string, unknown>
    if (op.id !== operationId) {
      throw new Error(`PROJECT_AGENT_OPERATION_ID_MISMATCH:${operationId}:${String(op.id)}`)
    }
    mustTrimmedString(op.summary, 'SUMMARY')
    const intent = mustTrimmedString(op.intent, 'INTENT')
    if (intent !== 'query' && intent !== 'plan' && intent !== 'act') {
      throw new Error(`PROJECT_AGENT_OPERATION_INTENT_INVALID:${operationId}:${intent}`)
    }
    if (!Array.isArray(op.groupPath) || op.groupPath.length === 0) {
      throw new Error(`PROJECT_AGENT_OPERATION_GROUP_PATH_MISSING:${operationId}`)
    }
    for (const segment of op.groupPath) {
      mustTrimmedString(segment, 'GROUP_PATH_SEGMENT')
    }
    const channels = op.channels as { tool?: unknown; api?: unknown } | undefined
    if (!channels || typeof channels !== 'object' || Array.isArray(channels)) {
      throw new Error(`PROJECT_AGENT_OPERATION_CHANNELS_MISSING:${operationId}`)
    }
    if (channels.tool !== true && channels.tool !== false) {
      throw new Error(`PROJECT_AGENT_OPERATION_CHANNELS_TOOL_INVALID:${operationId}`)
    }
    if (channels.api !== true && channels.api !== false) {
      throw new Error(`PROJECT_AGENT_OPERATION_CHANNELS_API_INVALID:${operationId}`)
    }
    const prerequisites = op.prerequisites as { episodeId?: unknown } | undefined
    const episodeId = prerequisites?.episodeId
    if (episodeId !== 'required' && episodeId !== 'optional' && episodeId !== 'forbidden') {
      throw new Error(`PROJECT_AGENT_OPERATION_PREREQUISITES_INVALID:${operationId}`)
    }
    const effects = op.effects as Record<string, unknown> | undefined
    if (!effects || typeof effects !== 'object' || Array.isArray(effects)) {
      throw new Error(`PROJECT_AGENT_OPERATION_EFFECTS_MISSING:${operationId}`)
    }
    const keys = [
      'writes',
      'billable',
      'destructive',
      'overwrite',
      'bulk',
      'externalSideEffects',
      'longRunning',
    ] as const
    for (const key of keys) {
      if (effects[key] !== true && effects[key] !== false) {
        throw new Error(`PROJECT_AGENT_OPERATION_EFFECTS_INVALID:${operationId}:${key}`)
      }
    }
    const agentFlow = op.agentFlow as {
      onTaskComplete?: unknown
      onTaskFailed?: unknown
      interruptsFor?: unknown
    } | undefined
    if (agentFlow !== undefined) {
      if (!agentFlow || typeof agentFlow !== 'object' || Array.isArray(agentFlow)) {
        throw new Error(`PROJECT_AGENT_OPERATION_AGENT_FLOW_INVALID:${operationId}`)
      }
      if (
        agentFlow.onTaskComplete !== undefined
        && agentFlow.onTaskComplete !== 'resume_agent'
        && agentFlow.onTaskComplete !== 'await_user_choice'
        && agentFlow.onTaskComplete !== 'complete'
      ) {
        throw new Error(`PROJECT_AGENT_OPERATION_AGENT_FLOW_ON_TASK_COMPLETE_INVALID:${operationId}`)
      }
      if (
        agentFlow.onTaskFailed !== undefined
        && agentFlow.onTaskFailed !== 'resume_agent'
        && agentFlow.onTaskFailed !== 'fail'
      ) {
        throw new Error(`PROJECT_AGENT_OPERATION_AGENT_FLOW_ON_TASK_FAILED_INVALID:${operationId}`)
      }
      if (
        agentFlow.interruptsFor !== undefined
        && agentFlow.interruptsFor !== null
        && agentFlow.interruptsFor !== 'approval'
        && agentFlow.interruptsFor !== 'choice'
      ) {
        throw new Error(`PROJECT_AGENT_OPERATION_AGENT_FLOW_INTERRUPTS_FOR_INVALID:${operationId}`)
      }
    }
    const confirmation = op.confirmation as { required?: unknown } | undefined
    if (!confirmation || typeof confirmation !== 'object' || Array.isArray(confirmation)) {
      throw new Error(`PROJECT_AGENT_OPERATION_CONFIRMATION_MISSING:${operationId}`)
    }
    if (confirmation.required !== true && confirmation.required !== false) {
      throw new Error(`PROJECT_AGENT_OPERATION_CONFIRMATION_REQUIRED_INVALID:${operationId}`)
    }
    const needsConfirm = requiresConfirmationByEffects(effects as {
      billable: boolean
      destructive: boolean
      overwrite: boolean
      bulk: boolean
      externalSideEffects: boolean
      longRunning: boolean
    })
    if (
      needsConfirm
      && channels.tool === true
      && confirmation.required !== true
      && !isToolConfirmationExemptOperationId(operationId)
    ) {
      throw new Error(`PROJECT_AGENT_OPERATION_CONFIRMATION_REQUIRED_MISMATCH:${operationId}`)
    }
    const toolInputSchema = op.toolInputSchema as { properties?: unknown; required?: unknown; additionalProperties?: unknown } | undefined
    if (channels.tool === true) {
      if (!toolInputSchema || typeof toolInputSchema !== 'object' || Array.isArray(toolInputSchema)) {
        throw new Error(`PROJECT_AGENT_OPERATION_TOOL_INPUT_SCHEMA_MISSING:${operationId}`)
      }
      if (!toolInputSchema.properties || typeof toolInputSchema.properties !== 'object' || Array.isArray(toolInputSchema.properties)) {
        throw new Error(`PROJECT_AGENT_OPERATION_TOOL_INPUT_SCHEMA_PROPERTIES_INVALID:${operationId}`)
      }
      if (!Array.isArray(toolInputSchema.required)) {
        throw new Error(`PROJECT_AGENT_OPERATION_TOOL_INPUT_SCHEMA_REQUIRED_INVALID:${operationId}`)
      }
      if (toolInputSchema.additionalProperties !== false) {
        throw new Error(`PROJECT_AGENT_OPERATION_TOOL_INPUT_SCHEMA_ADDITIONAL_PROPERTIES_INVALID:${operationId}`)
      }
    }
  }
}

export function createProjectAgentOperationRegistry() {
  const registry = createRawProjectAgentOperationRegistry()
  validateOperationRegistry(registry)
  return registry
}

export function createProjectAgentOperationRegistryForApi() {
  const base = createRawProjectAgentOperationRegistry()
  const apiOnly = createApiOnlyOperationRegistry()

  for (const id of Object.keys(apiOnly)) {
    if (Object.prototype.hasOwnProperty.call(base, id)) {
      throw new Error(`PROJECT_AGENT_API_OPERATION_ID_CONFLICT:${id}`)
    }
  }

  const merged = {
    ...base,
    ...apiOnly,
  }
  validateOperationRegistry(merged)
  return merged
}
