import { createProjectAgentOperationRegistry as createRawProjectAgentOperationRegistry } from './project-agent'
import { createApiOnlyOperationRegistry } from './api-only'
import { assertAssistantToolWriteAuthority } from './write-authority'
import { WORKSPACE_RESOURCE_IMPACT } from '@/lib/workspace-resource/resource-impact'
export type { ProjectAgentOperationContext, ProjectAgentOperationDefinition, ProjectAgentOperationRegistry } from './types'

function mustTrimmedString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`PROJECT_AGENT_OPERATION_${label}_INVALID`)
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`PROJECT_AGENT_OPERATION_${label}_EMPTY`)
  return trimmed
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
    const resourceContract = op.resourceContract as Record<string, unknown> | undefined
    if (!resourceContract || typeof resourceContract !== 'object' || Array.isArray(resourceContract)) {
      throw new Error(`PROJECT_AGENT_OPERATION_RESOURCE_CONTRACT_MISSING:${operationId}`)
    }
    if (resourceContract.kind === 'none') {
      mustTrimmedString(resourceContract.reason, 'RESOURCE_CONTRACT_REASON')
    } else if (resourceContract.kind === 'resource') {
      if (
        resourceContract.assistantPresentation !== 'none'
        && resourceContract.assistantPresentation !== 'created_resources'
      ) {
        throw new Error(`PROJECT_AGENT_OPERATION_RESOURCE_CONTRACT_PRESENTATION_INVALID:${operationId}`)
      }
      if (resourceContract.acceptsReferences !== true && resourceContract.acceptsReferences !== false) {
        throw new Error(`PROJECT_AGENT_OPERATION_RESOURCE_CONTRACT_REFERENCES_INVALID:${operationId}`)
      }
      if (resourceContract.supportsCandidates !== true && resourceContract.supportsCandidates !== false) {
        throw new Error(`PROJECT_AGENT_OPERATION_RESOURCE_CONTRACT_CANDIDATES_INVALID:${operationId}`)
      }
      if (!Array.isArray(resourceContract.outputMediaTypes) || resourceContract.outputMediaTypes.length === 0) {
        throw new Error(`PROJECT_AGENT_OPERATION_RESOURCE_CONTRACT_MEDIA_MISSING:${operationId}`)
      }
      if (!Array.isArray(resourceContract.outputSchemaIds) || resourceContract.outputSchemaIds.length === 0) {
        throw new Error(`PROJECT_AGENT_OPERATION_RESOURCE_CONTRACT_SCHEMA_MISSING:${operationId}`)
      }
    } else {
      throw new Error(`PROJECT_AGENT_OPERATION_RESOURCE_CONTRACT_KIND_INVALID:${operationId}`)
    }
    const keys = ['writes', 'billable', 'destructive', 'overwrite', 'bulk', 'externalSideEffects', 'longRunning'] as const
    for (const key of keys) {
      if (effects[key] !== true && effects[key] !== false) {
        throw new Error(`PROJECT_AGENT_OPERATION_EFFECTS_INVALID:${operationId}:${key}`)
      }
    }
    const workspaceResourceImpacts = new Set<string>(Object.values(WORKSPACE_RESOURCE_IMPACT))
    if (effects.writes === true) {
      if (
        typeof effects.workspaceResourceImpact !== 'string'
        || !workspaceResourceImpacts.has(effects.workspaceResourceImpact)
      ) {
        throw new Error(`PROJECT_AGENT_OPERATION_RESOURCE_IMPACT_INVALID:${operationId}`)
      }
    } else if (effects.workspaceResourceImpact !== undefined) {
      throw new Error(`PROJECT_AGENT_OPERATION_RESOURCE_IMPACT_FORBIDDEN:${operationId}`)
    }
    const agentFlow = op.agentFlow as
      | {
          suspendsFor?: unknown
        }
      | undefined
    if (agentFlow !== undefined) {
      if (!agentFlow || typeof agentFlow !== 'object' || Array.isArray(agentFlow)) {
        throw new Error(`PROJECT_AGENT_OPERATION_AGENT_FLOW_INVALID:${operationId}`)
      }
      if (
        agentFlow.suspendsFor !== undefined &&
        agentFlow.suspendsFor !== null &&
        agentFlow.suspendsFor !== 'choice'
      ) {
        throw new Error(`PROJECT_AGENT_OPERATION_AGENT_FLOW_SUSPENDS_FOR_INVALID:${operationId}`)
      }
    }
    const confirmation = op.confirmation as { kind?: unknown; required?: unknown } | undefined
    if (!confirmation || typeof confirmation !== 'object' || Array.isArray(confirmation)) {
      throw new Error(`PROJECT_AGENT_OPERATION_CONFIRMATION_MISSING:${operationId}`)
    }
    if (confirmation.required !== true && confirmation.required !== false) {
      throw new Error(`PROJECT_AGENT_OPERATION_CONFIRMATION_REQUIRED_INVALID:${operationId}`)
    }
    if (confirmation.kind !== 'none' && confirmation.kind !== 'billable_media' && confirmation.kind !== 'destructive') {
      throw new Error(`PROJECT_AGENT_OPERATION_CONFIRMATION_KIND_INVALID:${operationId}`)
    }
    if ((confirmation.kind === 'none') !== (confirmation.required === false)) {
      throw new Error(`PROJECT_AGENT_OPERATION_CONFIRMATION_KIND_REQUIRED_MISMATCH:${operationId}`)
    }
    if (agentFlow?.suspendsFor === 'choice') {
      if (
        channels.tool !== true
        || channels.api !== false
        || effects.writes !== false
        || confirmation.kind !== 'none'
        || confirmation.required !== false
      ) {
        throw new Error(`PROJECT_AGENT_OPERATION_CHOICE_LIFECYCLE_CONTRACT_INVALID:${operationId}`)
      }
    }
    const choiceCommit = op.choiceCommit as { enabled?: unknown } | undefined
    if (choiceCommit !== undefined) {
      if (
        !choiceCommit
        || typeof choiceCommit !== 'object'
        || Array.isArray(choiceCommit)
        || choiceCommit.enabled !== true
        || intent !== 'act'
        || channels.tool !== true
        || effects.writes !== true
        || effects.billable !== false
        || effects.destructive !== false
        || effects.bulk !== false
        || effects.externalSideEffects !== false
        || effects.longRunning !== false
        || confirmation.kind !== 'none'
        || confirmation.required !== false
        || agentFlow?.suspendsFor != null
        || typeof op.executeInTransaction !== 'function'
      ) {
        throw new Error(`PROJECT_AGENT_OPERATION_CHOICE_COMMIT_CONTRACT_INVALID:${operationId}`)
      }
    }
    if (confirmation.kind === 'billable_media') {
      mustTrimmedString(op.planContractRevision, 'PLAN_CONTRACT_REVISION')
      if (typeof op.plan !== 'function' || typeof op.commit !== 'function') {
        throw new Error(`PROJECT_AGENT_BILLABLE_OPERATION_PLAN_COMMIT_REQUIRED:${operationId}`)
      }
      if (
        op.execute !== undefined
        || op.executeInTransaction !== undefined
      ) {
        throw new Error(`PROJECT_AGENT_BILLABLE_OPERATION_EXECUTOR_FORBIDDEN:${operationId}`)
      }
    } else {
      if (op.planContractRevision !== undefined) {
        throw new Error(`PROJECT_AGENT_DIRECT_OPERATION_PLAN_CONTRACT_REVISION_FORBIDDEN:${operationId}`)
      }
      const hasDirectExecutor = typeof op.execute === 'function'
      const hasTransactionalExecutor = typeof op.executeInTransaction === 'function'
      if (Number(hasDirectExecutor) + Number(hasTransactionalExecutor) !== 1) {
        throw new Error(`PROJECT_AGENT_DIRECT_OPERATION_EXECUTOR_REQUIRED:${operationId}`)
      }
      if (op.plan !== undefined || op.commit !== undefined) {
        throw new Error(`PROJECT_AGENT_DIRECT_OPERATION_PLAN_COMMIT_FORBIDDEN:${operationId}`)
      }
      if (
        (op.prepareTransaction !== undefined || op.compensateTransactionFailure !== undefined)
        && (
          typeof op.prepareTransaction !== 'function'
          ||
          typeof op.compensateTransactionFailure !== 'function'
          ||
          !hasTransactionalExecutor
          || effects.externalSideEffects !== true
          || channels.tool !== false
        )
      ) {
        throw new Error(`PROJECT_AGENT_OPERATION_TRANSACTION_COMPENSATION_INVALID:${operationId}`)
      }
      if (
        effects.writes === true
        && effects.workspaceResourceImpact !== WORKSPACE_RESOURCE_IMPACT.NONE
        && effects.externalSideEffects === true
        && (
          typeof op.prepareTransaction !== 'function'
          || typeof op.compensateTransactionFailure !== 'function'
        )
      ) {
        throw new Error(`PROJECT_AGENT_OPERATION_TRANSACTION_COMPENSATION_REQUIRED:${operationId}`)
      }
    }
    assertAssistantToolWriteAuthority(operationId, op)
    const toolInputSchema = op.toolInputSchema as
      | {
          properties?: unknown
          required?: unknown
          additionalProperties?: unknown
        }
      | undefined
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

function createCompleteProjectAgentOperationRegistry() {
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

export function createProjectAgentOperationRegistry() {
  return createCompleteProjectAgentOperationRegistry()
}

export function createProjectAgentOperationRegistryForApi() {
  return createCompleteProjectAgentOperationRegistry()
}
