import type { Tool, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import type { ProjectAgentOperationDefinition } from '@/lib/operations/types'

/**
 * Stage 0 intentionally proves the MCP transport with the smallest useful
 * production surface. Before the production cutover, MCP exposure must become
 * a declaration owned by the Operation registry and this temporary allowlist
 * must be deleted rather than growing into a second capability registry.
 */
export const WAO_MCP_STAGE_0_OPERATION_IDS = [
  'create_image',
  'create_video',
  'create_audio',
  'generate_voice',
  'merge_videos',
] as const

export type WaoMcpStage0OperationId =
  (typeof WAO_MCP_STAGE_0_OPERATION_IDS)[number]

export interface WaoMcpOperationCatalogEntry {
  readonly operationId: WaoMcpStage0OperationId
  readonly operation: ProjectAgentOperationDefinition
  readonly tool: Tool
}

function projectAnnotations(
  operation: ProjectAgentOperationDefinition,
): ToolAnnotations {
  return {
    readOnlyHint: !operation.effects.writes,
    destructiveHint:
      operation.effects.destructive ||
      operation.confirmation.kind === 'destructive',
    openWorldHint: operation.effects.externalSideEffects,
  }
}

function projectTool(
  operation: ProjectAgentOperationDefinition,
): Tool {
  return {
    name: operation.id,
    description: operation.summary,
    // Registry construction already validates this as a closed object JSON
    // Schema. Keep the exact registry-owned object; MCP must not regenerate or
    // reinterpret the Operation contract.
    inputSchema: operation.toolInputSchema as unknown as Tool['inputSchema'],
    annotations: projectAnnotations(operation),
  }
}

export function createWaoMcpOperationCatalog(): readonly WaoMcpOperationCatalogEntry[] {
  const registry = createProjectAgentOperationRegistry()

  return WAO_MCP_STAGE_0_OPERATION_IDS.map((operationId) => {
    const operation = registry[operationId]
    if (!operation) {
      throw new Error(`WAO_MCP_OPERATION_NOT_REGISTERED:${operationId}`)
    }
    if (!operation.channels.tool) {
      throw new Error(`WAO_MCP_OPERATION_TOOL_CHANNEL_REQUIRED:${operationId}`)
    }
    return {
      operationId,
      operation,
      tool: projectTool(operation),
    }
  })
}
