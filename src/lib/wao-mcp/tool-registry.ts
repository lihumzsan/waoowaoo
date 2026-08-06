import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import {
  createWaoMcpOperationCatalog,
  type WaoMcpOperationCatalogEntry,
} from './operation-catalog'
import {
  WAO_MCP_USER_DECISION_TOOL,
  WAO_MCP_USER_DECISION_TOOL_NAME,
} from './user-decision'

export type WaoMcpToolRegistryEntry =
  | {
      readonly kind: 'operation'
      readonly name: string
      readonly tool: Tool
      readonly operation: WaoMcpOperationCatalogEntry
    }
  | {
      readonly kind: 'user_decision'
      readonly name: typeof WAO_MCP_USER_DECISION_TOOL_NAME
      readonly tool: Tool
    }

/** The exhaustive declaration of tools exposed by the required Wao MCP server. */
export function createWaoMcpToolRegistry(): readonly WaoMcpToolRegistryEntry[] {
  const entries: WaoMcpToolRegistryEntry[] = [
    ...createWaoMcpOperationCatalog().map((operation): WaoMcpToolRegistryEntry => ({
      kind: 'operation',
      name: operation.operationId,
      tool: operation.tool,
      operation,
    })),
    {
      kind: 'user_decision',
      name: WAO_MCP_USER_DECISION_TOOL_NAME,
      tool: WAO_MCP_USER_DECISION_TOOL,
    },
  ]
  const names = new Set<string>()
  for (const entry of entries) {
    if (entry.name !== entry.tool.name) {
      throw new Error(`WAO_MCP_TOOL_NAME_MISMATCH:${entry.name}:${entry.tool.name}`)
    }
    if (names.has(entry.name)) throw new Error(`WAO_MCP_TOOL_NAME_DUPLICATE:${entry.name}`)
    names.add(entry.name)
  }
  return entries
}
