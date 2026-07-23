import { tool, type Tool } from '@openai/agents'
import type { ProjectAgentOperationRegistry } from '@/lib/operations/types'
import type { ProjectAgentLocale } from './locale'
import type { ProjectAgentToolset } from './toolset'

export const PROJECT_AGENT_TOOL_DISCOVERY_NAME = 'load_tools'
export const PROJECT_AGENT_TOOL_LOAD_LIMIT = 4
export const PROJECT_AGENT_TOOL_CATALOG_DESCRIPTION_LIMIT = 160

export interface ProjectAgentToolCatalogEntry {
  readonly operationId: string
  readonly groupPath: readonly string[]
  readonly description: string
}

export interface ProjectAgentToolLoadResult {
  readonly newlyLoadedOperationIds: readonly string[]
  readonly loadedOperationIds: readonly string[]
}

export interface ProjectAgentToolDiscoveryState {
  readonly catalog: readonly ProjectAgentToolCatalogEntry[]
  isLoaded: (operationId: string) => boolean
  load: (operationIds: readonly string[]) => ProjectAgentToolLoadResult
  loadedOperationIds: () => readonly string[]
}

export function formatProjectAgentToolNotFound(params: {
  readonly toolName: string
  readonly catalog: readonly ProjectAgentToolCatalogEntry[]
  readonly locale: ProjectAgentLocale
}): string {
  const isRegisteredOperation = params.catalog.some((entry) => (
    entry.operationId === params.toolName
  ))
  if (isRegisteredOperation) {
    return params.locale === 'zh'
      ? `Operation "${params.toolName}" 已注册，但在发出本次调用的模型步骤中尚未加载。先用 load_tools 加载这个精确 id，等待下一模型步骤出现完整 Schema，再按该 Schema 重新调用；不要猜测参数，也不要在同一回复里同时加载并调用。`
      : `Operation "${params.toolName}" is registered but was not loaded in the model step that emitted this call. Load this exact id with load_tools, wait for its full Schema in the next model step, then call it again from that Schema. Do not guess arguments or load and invoke it in the same response.`
  }
  return params.locale === 'zh'
    ? `工具 "${params.toolName}" 未注册。只使用 load_tools 目录中的精确 id；不要发明工具或参数。`
    : `Tool "${params.toolName}" is not registered. Use only exact ids from the load_tools catalog; do not invent tools or arguments.`
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
  return params.toolset.operationIds.map((operationId) => {
    if (operationId === PROJECT_AGENT_TOOL_DISCOVERY_NAME) {
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
  readonly initiallyLoadedOperationIds?: readonly string[]
}): ProjectAgentToolDiscoveryState {
  const catalog = [...params.catalog]
  const knownOperationIds = new Set(catalog.map((entry) => entry.operationId))
  if (knownOperationIds.size !== catalog.length) {
    throw new Error('PROJECT_AGENT_TOOL_CATALOG_ID_DUPLICATE')
  }
  const initialIds = params.initiallyLoadedOperationIds ?? []
  for (const operationId of initialIds) {
    if (!knownOperationIds.has(operationId)) {
      throw new Error(`PROJECT_AGENT_TOOL_INITIAL_LOAD_ID_UNKNOWN:${operationId}`)
    }
  }
  const loaded = new Set(initialIds)
  const listLoaded = (): string[] => catalog
    .filter((entry) => loaded.has(entry.operationId))
    .map((entry) => entry.operationId)

  return {
    catalog,
    isLoaded(operationId) {
      return loaded.has(operationId)
    },
    load(operationIds) {
      const normalized = validateRequestedOperationIds({ operationIds, knownOperationIds })
      const newlyLoaded = new Set<string>()
      for (const operationId of normalized) {
        if (!loaded.has(operationId)) newlyLoaded.add(operationId)
        loaded.add(operationId)
      }
      return {
        newlyLoadedOperationIds: catalog
          .filter((entry) => newlyLoaded.has(entry.operationId))
          .map((entry) => entry.operationId),
        loadedOperationIds: listLoaded(),
      }
    },
    loadedOperationIds: listLoaded,
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
  locale: ProjectAgentLocale,
): string {
  const catalogLines = catalog.map((entry) => (
    `[${entry.groupPath.join('/')}] ${entry.operationId} — ${entry.description}`
  ))
  const introduction = locale === 'zh'
    ? `按需载入完成当前目标所需 Operation 的完整调用定义。下面目录只用于发现能力（精确 id + 简介），不是参数契约、工作流或调用顺序。调用 Operation 前，先按精确 id 加载最小充分集合；每次最多 ${PROJECT_AGENT_TOOL_LOAD_LIMIT} 个。必须等待下一模型步骤看到完整 Schema 后再调用，不能在同一回复里同时加载并猜测调用。已加载项在当前执行段内持续可用。`
    : `Load the full invocation definitions for the Operations needed by the current goal. The catalog below is capability discovery only (exact id plus summary), never an argument contract, workflow, or call order. Before calling an Operation, load the smallest sufficient set by exact id, up to ${PROJECT_AGENT_TOOL_LOAD_LIMIT} per call. Wait until the next model step exposes the full Schema before invoking it; never load and guess the invocation in the same response. Loaded Operations remain available for the current execution segment.`
  const catalogLabel = locale === 'zh' ? '能力目录：' : 'Capability catalog:'
  return [introduction, catalogLabel, ...catalogLines].join('\n')
}

export function createProjectAgentToolDiscoveryTool<Context>(params: {
  readonly state: ProjectAgentToolDiscoveryState
  readonly locale: ProjectAgentLocale
}): Tool<Context> {
  const operationIds = params.state.catalog.map((entry) => entry.operationId)
  return tool({
    name: PROJECT_AGENT_TOOL_DISCOVERY_NAME,
    description: buildDiscoveryDescription(params.state.catalog, params.locale),
    parameters: {
      type: 'object',
      properties: {
        toolIds: {
          type: 'array',
          description: params.locale === 'zh'
            ? '要加载完整调用定义的精确 Operation id。'
            : 'Exact Operation ids whose full invocation definitions should be loaded.',
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
    execute: (input: unknown): ProjectAgentToolLoadResult => params.state.load(readToolIds(input)),
  }) as Tool<Context>
}
