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
    const channels = op.channels as {
      tool?: unknown
      api?: unknown
      mcp?: unknown
    } | undefined
    if (!channels || typeof channels !== 'object' || Array.isArray(channels)) {
      throw new Error(`PROJECT_AGENT_OPERATION_CHANNELS_MISSING:${operationId}`)
    }
    if (channels.tool !== true && channels.tool !== false) {
      throw new Error(`PROJECT_AGENT_OPERATION_CHANNELS_TOOL_INVALID:${operationId}`)
    }
    if (channels.api !== true && channels.api !== false) {
      throw new Error(`PROJECT_AGENT_OPERATION_CHANNELS_API_INVALID:${operationId}`)
    }
    if (channels.mcp !== true && channels.mcp !== false) {
      throw new Error(`PROJECT_AGENT_OPERATION_CHANNELS_MCP_INVALID:${operationId}`)
    }
    if (channels.mcp === true && channels.tool !== true) {
      throw new Error(
        `PROJECT_AGENT_OPERATION_CHANNELS_MCP_TOOL_REQUIRED:${operationId}`,
      )
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
      const outputResourceKinds = resourceContract.outputResourceKinds
      if (
        !Array.isArray(outputResourceKinds)
        || outputResourceKinds.length === 0
        || outputResourceKinds.some((kind) => kind !== 'file' && kind !== 'folder')
        || new Set(outputResourceKinds).size !== outputResourceKinds.length
      ) {
        throw new Error(`PROJECT_AGENT_OPERATION_RESOURCE_CONTRACT_RESOURCE_KIND_INVALID:${operationId}`)
      }
      const producesFile = outputResourceKinds.includes('file')
      if (
        !Array.isArray(resourceContract.outputMediaTypes)
        || (producesFile && resourceContract.outputMediaTypes.length === 0)
        || (!producesFile && resourceContract.outputMediaTypes.length !== 0)
        || resourceContract.outputMediaTypes.some((mediaType) => (
          mediaType !== 'text' && mediaType !== 'image' && mediaType !== 'audio' && mediaType !== 'video'
        ))
        || new Set(resourceContract.outputMediaTypes).size !== resourceContract.outputMediaTypes.length
      ) {
        throw new Error(`PROJECT_AGENT_OPERATION_RESOURCE_CONTRACT_MEDIA_MISSING:${operationId}`)
      }
      if (
        !Array.isArray(resourceContract.outputSchemaIds)
        || resourceContract.outputSchemaIds.length === 0
        || resourceContract.outputSchemaIds.some((schemaId) => typeof schemaId !== 'string' || !schemaId.trim())
        || new Set(resourceContract.outputSchemaIds).size !== resourceContract.outputSchemaIds.length
      ) {
        throw new Error(`PROJECT_AGENT_OPERATION_RESOURCE_CONTRACT_SCHEMA_MISSING:${operationId}`)
      }
      if (resourceContract.placement !== 'required') {
        throw new Error(`PROJECT_AGENT_OPERATION_RESOURCE_CONTRACT_PLACEMENT_INVALID:${operationId}`)
      }
      const alternativeGeneration = resourceContract.alternativeGeneration
      if (alternativeGeneration !== undefined) {
        if (
          !alternativeGeneration
          || typeof alternativeGeneration !== 'object'
          || Array.isArray(alternativeGeneration)
        ) {
          throw new Error(`PROJECT_AGENT_OPERATION_ALTERNATIVE_CAPABILITY_INVALID:${operationId}`)
        }
        const capability = alternativeGeneration as Record<string, unknown>
        if (
          capability.kind !== 'request_count'
          || !['image', 'video', 'music', 'voice'].includes(String(capability.mediaKind))
          || capability.requestKind !== 'new'
          || typeof capability.defaultSchemaId !== 'string'
          || !capability.defaultSchemaId.trim()
          || capability.minCount !== 1
          || capability.maxCount !== 6
        ) {
          throw new Error(`PROJECT_AGENT_OPERATION_ALTERNATIVE_CAPABILITY_INVALID:${operationId}`)
        }
        const expectedOutputMediaType = capability.mediaKind === 'music' || capability.mediaKind === 'voice'
          ? 'audio'
          : capability.mediaKind
        if (!(resourceContract.outputMediaTypes as unknown[]).includes(expectedOutputMediaType)) {
          throw new Error(`PROJECT_AGENT_OPERATION_ALTERNATIVE_CAPABILITY_MEDIA_MISMATCH:${operationId}`)
        }
        if (!(resourceContract.outputSchemaIds as unknown[]).includes(capability.defaultSchemaId)) {
          throw new Error(`PROJECT_AGENT_OPERATION_ALTERNATIVE_CAPABILITY_SCHEMA_MISMATCH:${operationId}`)
        }
        const inputLimits = capability.inputLimits
        if (inputLimits !== undefined) {
          if (!inputLimits || typeof inputLimits !== 'object' || Array.isArray(inputLimits)) {
            throw new Error(`PROJECT_AGENT_OPERATION_ALTERNATIVE_CAPABILITY_LIMITS_INVALID:${operationId}`)
          }
          const limits = inputLimits as Record<string, unknown>
          const duration = limits.durationSeconds
          if (duration !== undefined) {
            if (!duration || typeof duration !== 'object' || Array.isArray(duration)) {
              throw new Error(`PROJECT_AGENT_OPERATION_ALTERNATIVE_CAPABILITY_LIMITS_INVALID:${operationId}`)
            }
            const range = duration as Record<string, unknown>
            if (
              typeof range.min !== 'number'
              || typeof range.max !== 'number'
              || !Number.isInteger(range.min)
              || !Number.isInteger(range.max)
              || range.min < 1
              || range.max < range.min
            ) {
              throw new Error(`PROJECT_AGENT_OPERATION_ALTERNATIVE_CAPABILITY_LIMITS_INVALID:${operationId}`)
            }
          }
          for (const key of ['promptMaxLength', 'previewTextMaxLength'] as const) {
            const value = limits[key]
            if (value !== undefined && (
              typeof value !== 'number'
              || !Number.isInteger(value)
              || value < 1
            )) {
              throw new Error(`PROJECT_AGENT_OPERATION_ALTERNATIVE_CAPABILITY_LIMITS_INVALID:${operationId}`)
            }
          }
        }
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
    if (channels.tool === true && effects.writes === true) {
      mustTrimmedString(op.toolContractRevision, 'TOOL_CONTRACT_REVISION')
    } else if (op.toolContractRevision !== null) {
      throw new Error(
        `PROJECT_AGENT_OPERATION_TOOL_CONTRACT_REVISION_FORBIDDEN:${operationId}`,
      )
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
    if (
      effects.writes === true
      && effects.workspaceResourceImpact !== WORKSPACE_RESOURCE_IMPACT.NONE
      && (
        confirmation.kind === 'billable_media'
        || typeof op.executeInTransaction !== 'function'
      )
    ) {
      throw new Error(
        `PROJECT_AGENT_OPERATION_CHANGED_REFS_OWNER_INVALID:${operationId}`,
      )
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
      const canonicalizer = op.toolInputCanonicalizer
      if (canonicalizer !== undefined) {
        if (!canonicalizer || typeof canonicalizer !== 'object' || Array.isArray(canonicalizer)) {
          throw new Error(`PROJECT_AGENT_OPERATION_TOOL_INPUT_CANONICALIZER_INVALID:${operationId}`)
        }
        const contract = canonicalizer as Record<string, unknown>
        const inputSchema = contract.inputSchema
        if (
          typeof contract.canonicalize !== 'function'
          || !inputSchema
          || typeof inputSchema !== 'object'
          || Array.isArray(inputSchema)
          || typeof (inputSchema as Record<string, unknown>).safeParse !== 'function'
        ) {
          throw new Error(`PROJECT_AGENT_OPERATION_TOOL_INPUT_CANONICALIZER_INVALID:${operationId}`)
        }
      }
    } else if (op.toolInputCanonicalizer !== undefined) {
      throw new Error(`PROJECT_AGENT_OPERATION_TOOL_INPUT_CANONICALIZER_CHANNEL_INVALID:${operationId}`)
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
