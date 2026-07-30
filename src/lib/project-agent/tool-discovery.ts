import { tool, type Tool } from '@openai/agents'
import type {
  ProjectAgentOperationRegistry,
  ProjectAgentToolInputSchema,
} from '@/lib/operations/types'
import type { ProjectAgentToolset } from './toolset'

export const PROJECT_AGENT_TOOL_DISCOVERY_NAME = 'load_tools'
export const PROJECT_AGENT_OPERATION_GATEWAY_NAME = 'execute_operation'
export const PROJECT_AGENT_TOOL_LOAD_LIMIT = 4
export const PROJECT_AGENT_TOOL_CATALOG_DESCRIPTION_LIMIT = 160

export interface ProjectAgentToolCatalogEntry {
  readonly operationId: string
  readonly groupPath: readonly string[]
  readonly description: string
  readonly parameters: ProjectAgentToolInputSchema
}

export interface ProjectAgentLoadedOperationDefinition {
  readonly operationId: string
  readonly description: string
  readonly parameters: ProjectAgentToolInputSchema
}

export interface ProjectAgentToolLoadResult {
  readonly operations: readonly ProjectAgentLoadedOperationDefinition[]
  readonly executeWith: {
    readonly toolName: typeof PROJECT_AGENT_OPERATION_GATEWAY_NAME
    readonly arguments: {
      readonly operationId: 'Copy operations[].operationId exactly'
      readonly argumentsJson: 'JSON object matching operations[].parameters'
    }
  }
}

export interface ProjectAgentToolDiscoveryState {
  readonly catalog: readonly ProjectAgentToolCatalogEntry[]
  load: (operationIds: readonly string[]) => Promise<ProjectAgentToolLoadResult>
}

export function formatProjectAgentToolNotFound(params: {
  readonly toolName: string
  readonly catalog: readonly ProjectAgentToolCatalogEntry[]
}): string {
  const isRegisteredOperation = params.catalog.some((entry) => (
    entry.operationId === params.toolName
  ))
  if (isRegisteredOperation) {
    return `Operation "${params.toolName}" is registered but cannot be called as a tool name. Load this exact id with load_tools, read the returned parameters, then call execute_operation. Do not guess arguments.`
  }
  return `Tool "${params.toolName}" is not registered. Call only tools provided directly in the current request; for other capabilities, load an exact catalog Operation id with load_tools and then call execute_operation.`
}

function compactCatalogDescription(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) throw new Error('PROJECT_AGENT_TOOL_CATALOG_DESCRIPTION_EMPTY')
  const firstSentence = normalized.match(/^.*?[.!?。！？](?:\s|$)/u)?.[0]?.trim() ?? normalized
  if (firstSentence.length <= PROJECT_AGENT_TOOL_CATALOG_DESCRIPTION_LIMIT) return firstSentence
  const tentative = firstSentence.slice(0, PROJECT_AGENT_TOOL_CATALOG_DESCRIPTION_LIMIT - 1)
  const lastSpace = tentative.lastIndexOf(' ')
  const cutAt = lastSpace >= Math.floor(PROJECT_AGENT_TOOL_CATALOG_DESCRIPTION_LIMIT * 0.6)
    ? lastSpace
    : tentative.length
  return `${tentative.slice(0, cutAt).trimEnd()}…`
}

export function createProjectAgentToolCatalog(params: {
  readonly registry: ProjectAgentOperationRegistry
  readonly toolset: ProjectAgentToolset
  readonly describeOperation?: (operationId: string, fallback: string) => string
}): readonly ProjectAgentToolCatalogEntry[] {
  return params.toolset.onDemandOperationIds.map((operationId) => {
    if (
      operationId === PROJECT_AGENT_TOOL_DISCOVERY_NAME
      || operationId === PROJECT_AGENT_OPERATION_GATEWAY_NAME
    ) {
      throw new Error(`PROJECT_AGENT_TOOL_CATALOG_ID_RESERVED:${operationId}`)
    }
    const operation = params.registry[operationId]
    if (!operation || !operation.channels.tool) {
      throw new Error(`PROJECT_AGENT_TOOL_CATALOG_OPERATION_INVALID:${operationId}`)
    }
    return {
      operationId,
      groupPath: [...operation.groupPath],
      description: compactCatalogDescription(
        params.describeOperation?.(operationId, operation.summary) ?? operation.summary,
      ),
      parameters: operation.toolInputSchema,
    }
  })
}

function validateRequestedOperationIds(params: {
  readonly operationIds: readonly string[]
  readonly knownOperationIds: ReadonlySet<string>
}): string[] {
  if (params.operationIds.length < 1 || params.operationIds.length > PROJECT_AGENT_TOOL_LOAD_LIMIT) {
    throw new Error(`PROJECT_AGENT_TOOL_LOAD_COUNT_INVALID:${params.operationIds.length}`)
  }
  const normalized = params.operationIds.map((operationId) => operationId.trim())
  if (normalized.some((operationId) => !operationId)) {
    throw new Error('PROJECT_AGENT_TOOL_LOAD_ID_EMPTY')
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('PROJECT_AGENT_TOOL_LOAD_ID_DUPLICATE')
  }
  for (const operationId of normalized) {
    if (!params.knownOperationIds.has(operationId)) {
      throw new Error(`PROJECT_AGENT_TOOL_LOAD_ID_UNKNOWN:${operationId}`)
    }
  }
  return normalized
}

export function createProjectAgentToolDiscoveryState(params: {
  readonly catalog: readonly ProjectAgentToolCatalogEntry[]
}): ProjectAgentToolDiscoveryState {
  const catalog = [...params.catalog]
  const knownOperationIds = new Set(catalog.map((entry) => entry.operationId))
  if (knownOperationIds.size !== catalog.length) {
    throw new Error('PROJECT_AGENT_TOOL_CATALOG_ID_DUPLICATE')
  }

  return {
    catalog,
    async load(operationIds) {
      const normalized = validateRequestedOperationIds({ operationIds, knownOperationIds })
      const definitions = normalized.map((
        operationId,
      ): ProjectAgentLoadedOperationDefinition => {
        const entry = catalog.find((candidate) => candidate.operationId === operationId)
        if (!entry) throw new Error(`PROJECT_AGENT_TOOL_LOAD_ID_UNKNOWN:${operationId}`)
        return {
          operationId,
          description: entry.description,
          parameters: entry.parameters,
        }
      })
      return {
        operations: definitions,
        executeWith: {
          toolName: PROJECT_AGENT_OPERATION_GATEWAY_NAME,
          arguments: {
            operationId: 'Copy operations[].operationId exactly',
            argumentsJson: 'JSON object matching operations[].parameters',
          },
        },
      }
    },
  }
}

function readToolIds(input: unknown): string[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('PROJECT_AGENT_TOOL_LOAD_INPUT_INVALID')
  }
  const toolIds = (input as Record<string, unknown>).toolIds
  if (!Array.isArray(toolIds) || toolIds.some((operationId) => typeof operationId !== 'string')) {
    throw new Error('PROJECT_AGENT_TOOL_LOAD_IDS_INVALID')
  }
  return toolIds
}

function buildDiscoveryDescription(
  catalog: readonly ProjectAgentToolCatalogEntry[],
): string {
  const catalogLines = catalog.map((entry) => (
    `[${entry.groupPath.join('/')}] ${entry.operationId} — ${entry.description}`
  ))
  const introduction = `Read the canonical parameter definitions for the Operations needed by the current goal. Common tools already provided directly with complete Schemas are omitted from this catalog and should be called directly. The catalog below discovers only the remaining capabilities (exact id plus summary); it is never an argument contract, workflow, or call order. Before execution, load the smallest sufficient set by exact id, up to ${PROJECT_AGENT_TOOL_LOAD_LIMIT} per call; after reading the returned parameters, call execute_operation in a later model step. Never guess arguments or call a catalog Operation id as a tool name.`
  return [introduction, 'Capability catalog:', ...catalogLines].join('\n')
}

export function buildProjectAgentOperationGatewayDescription(): string {
  return 'Execute one Operation whose canonical definition was read through load_tools. Copy operationId exactly and pass argumentsJson matching parameters. Input is always validated by the canonical registry Schema.'
}

export function createProjectAgentToolDiscoveryTool<Context>(params: {
  readonly state: ProjectAgentToolDiscoveryState
}): Tool<Context> {
  const operationIds = params.state.catalog.map((entry) => entry.operationId)
  return tool({
    name: PROJECT_AGENT_TOOL_DISCOVERY_NAME,
    description: buildDiscoveryDescription(params.state.catalog),
    parameters: {
      type: 'object',
      properties: {
        toolIds: {
          type: 'array',
          description: 'Exact Operation ids whose full invocation definitions should be loaded.',
          items: {
            type: 'string',
            enum: operationIds,
          },
          minItems: 1,
          maxItems: PROJECT_AGENT_TOOL_LOAD_LIMIT,
        },
      },
      required: ['toolIds'],
      additionalProperties: false,
    } as never,
    strict: true,
    execute: async (input: unknown): Promise<ProjectAgentToolLoadResult> => (
      await params.state.load(readToolIds(input))
    ),
  }) as Tool<Context>
}
