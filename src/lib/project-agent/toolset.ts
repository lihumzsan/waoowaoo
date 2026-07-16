import type { ProjectAgentOperationRegistry } from '@/lib/operations/types'

export interface ProjectAgentToolset {
  readonly source: 'operation-registry'
  readonly operationIds: readonly string[]
  readonly disabledOperationIds: readonly string[]
}

/**
 * The production Operation registry is the only tool-surface authority.
 * Workflow guidance can recommend an operation, but it cannot hide a
 * registered user-authorized capability from the Agent.
 */
export function resolveProjectAgentToolset(params: {
  readonly registry: ProjectAgentOperationRegistry
  readonly disabledOperationIds?: readonly string[]
}): ProjectAgentToolset {
  const disabledOperationIds = Array.from(new Set(
    (params.disabledOperationIds ?? []).map((operationId) => operationId.trim()).filter(Boolean),
  )).sort()
  const operationIds = Object.values(params.registry)
    .filter((operation) => operation.channels.tool && !disabledOperationIds.includes(operation.id))
    .map((operation) => operation.id)
    .sort()
  return {
    source: 'operation-registry',
    operationIds,
    disabledOperationIds,
  }
}
