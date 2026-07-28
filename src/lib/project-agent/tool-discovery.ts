import { randomUUID } from 'node:crypto'
import { tool, type Tool } from '@openai/agents'
import type {
  ProjectAgentOperationRegistry,
  ProjectAgentToolInputSchema,
  ProjectAgentToolInputBinding,
  ProjectAgentToolInputBindingContext,
  RuntimeSchema,
} from '@/lib/operations/types'
import { createProjectAgentToolInputSchema } from '@/lib/operations/tool-input-schema'
import { stableArgsFingerprint } from './stable-args-hash'
import type { ProjectAgentLocale } from './locale'
import type { ProjectAgentToolset } from './toolset'

export const PROJECT_AGENT_TOOL_DISCOVERY_NAME = 'load_tools'
export const PROJECT_AGENT_OPERATION_GATEWAY_NAME = 'execute_operation'
export const PROJECT_AGENT_TOOL_LOAD_LIMIT = 4
export const PROJECT_AGENT_TOOL_CATALOG_DESCRIPTION_LIMIT = 160
const PROJECT_AGENT_BOUND_TOOL_PROTOCOL_VERSION = 'project-agent-bound-tool-v1'

export interface ProjectAgentToolCatalogEntry {
  readonly operationId: string
  readonly groupPath: readonly string[]
  readonly description: string
  readonly parameters: ProjectAgentToolInputSchema
}

export interface ProjectAgentLoadedOperationDefinition {
  readonly operationId: string
  readonly contractId: string
  readonly revision: string
  readonly description: string
  readonly parameters: ProjectAgentToolInputSchema
}

export interface ProjectAgentToolLoadResult {
  readonly newlyLoadedOperationIds: readonly string[]
  readonly loadedOperationIds: readonly string[]
  readonly operations: readonly ProjectAgentLoadedOperationDefinition[]
  readonly executeWith: {
    readonly toolName: typeof PROJECT_AGENT_OPERATION_GATEWAY_NAME
    readonly arguments: {
      readonly operationId: 'Copy operations[].operationId exactly'
      readonly contractId: 'Copy operations[].contractId exactly'
      readonly argumentsJson: 'JSON object matching operations[].parameters'
    }
  }
}

export interface ProjectAgentResolvedToolContract {
  readonly operationId: string
  readonly contractId: string
  readonly revision: string
  readonly inputSchema: RuntimeSchema<unknown>
  readonly toolInputSchema: ProjectAgentToolInputSchema
  readonly state?: unknown
}

export interface ProjectAgentToolDiscoveryState {
  readonly catalog: readonly ProjectAgentToolCatalogEntry[]
  isLoaded: (operationId: string) => boolean
  load: (operationIds: readonly string[]) => Promise<ProjectAgentToolLoadResult>
  resolveContract: (
    operationId: string,
    contractId: string,
  ) => Promise<ProjectAgentResolvedToolContract>
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
      ? `Operation "${params.toolName}" 已注册，但不能直接作为工具名调用。先用 load_tools 加载这个精确 id，读取返回的完整 parameters，再调用 execute_operation；不要猜测参数。`
      : `Operation "${params.toolName}" is registered but cannot be called as a tool name. Load this exact id with load_tools, read the returned parameters, then call execute_operation. Do not guess arguments.`
  }
  return params.locale === 'zh'
    ? `工具 "${params.toolName}" 未注册。只调用当前请求直接提供的工具；其余能力先用 load_tools 加载目录中的精确 Operation id，再调用 execute_operation。`
    : `Tool "${params.toolName}" is not registered. Call only tools provided directly in the current request; for other capabilities, load an exact catalog Operation id with load_tools and then call execute_operation.`
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
  readonly registry: ProjectAgentOperationRegistry
  readonly bindingContext: ProjectAgentToolInputBindingContext
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
  type BoundContract = ProjectAgentResolvedToolContract
  const contractsById = new Map<string, BoundContract>()
  const latestContractIdByOperation = new Map<string, string>()
  const listLoaded = (): string[] => catalog
    .filter((entry) => loaded.has(entry.operationId))
    .map((entry) => entry.operationId)

  const bindOperation = async (
    operationId: string,
  ): Promise<Omit<BoundContract, 'contractId'>> => {
    const operation = params.registry[operationId]
    if (
      !operation
      || !operation.channels.tool
      || operation.toolExposure !== 'on_demand'
    ) {
      throw new Error(`PROJECT_AGENT_TOOL_BOUND_OPERATION_INVALID:${operationId}`)
    }
    const binding: ProjectAgentToolInputBinding<unknown> = operation.bindToolInputSchema
      ? await operation.bindToolInputSchema(params.bindingContext)
      : { inputSchema: operation.inputSchema }
    const toolInputSchema = operation.bindToolInputSchema
      ? createProjectAgentToolInputSchema({
          operationId,
          inputSchema: binding.inputSchema,
        })
      : operation.toolInputSchema
    const revision = stableArgsFingerprint({
      protocolVersion: PROJECT_AGENT_BOUND_TOOL_PROTOCOL_VERSION,
      operationId,
      toolInputSchema,
    })
    return {
      operationId,
      revision,
      inputSchema: binding.inputSchema,
      toolInputSchema,
      ...(binding.state === undefined ? {} : { state: binding.state }),
    }
  }

  const loadContract = async (operationId: string): Promise<BoundContract> => {
    const current = await bindOperation(operationId)
    const latestId = latestContractIdByOperation.get(operationId)
    const latest = latestId ? contractsById.get(latestId) : null
    if (latest?.revision === current.revision) return latest
    const contract: BoundContract = {
      ...current,
      contractId: randomUUID(),
    }
    contractsById.set(contract.contractId, contract)
    latestContractIdByOperation.set(operationId, contract.contractId)
    return contract
  }

  return {
    catalog,
    isLoaded(operationId) {
      return loaded.has(operationId)
    },
    async load(operationIds) {
      const normalized = validateRequestedOperationIds({ operationIds, knownOperationIds })
      const newlyLoaded = new Set<string>()
      for (const operationId of normalized) {
        if (!loaded.has(operationId)) newlyLoaded.add(operationId)
        loaded.add(operationId)
      }
      const boundContracts = await Promise.all(normalized.map(loadContract))
      return {
        newlyLoadedOperationIds: catalog
          .filter((entry) => newlyLoaded.has(entry.operationId))
          .map((entry) => entry.operationId),
        loadedOperationIds: listLoaded(),
        operations: boundContracts.map((contract) => {
          const operationId = contract.operationId
          const entry = catalog.find((candidate) => candidate.operationId === operationId)
          if (!entry) throw new Error(`PROJECT_AGENT_TOOL_LOAD_ID_UNKNOWN:${operationId}`)
          return {
            operationId: entry.operationId,
            contractId: contract.contractId,
            revision: contract.revision,
            description: entry.description,
            parameters: contract.toolInputSchema,
          }
        }),
        executeWith: {
          toolName: PROJECT_AGENT_OPERATION_GATEWAY_NAME,
          arguments: {
            operationId: 'Copy operations[].operationId exactly',
            contractId: 'Copy operations[].contractId exactly',
            argumentsJson: 'JSON object matching operations[].parameters',
          },
        },
      }
    },
    async resolveContract(operationId, contractId) {
      const contract = contractsById.get(contractId)
      if (!contract) {
        throw new Error(`PROJECT_AGENT_OPERATION_CONTRACT_UNKNOWN:${operationId}`)
      }
      if (contract.operationId !== operationId) {
        throw new Error(`PROJECT_AGENT_OPERATION_CONTRACT_MISMATCH:${operationId}`)
      }
      const current = await bindOperation(operationId)
      if (current.revision !== contract.revision) {
        throw new Error(`PROJECT_AGENT_OPERATION_CONTRACT_STALE:${operationId}`)
      }
      return {
        ...contract,
        inputSchema: current.inputSchema,
        toolInputSchema: current.toolInputSchema,
        state: current.state,
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
    ? `按需读取完成当前目标所需 Operation 的完整参数定义。当前请求中已经直接提供完整 Schema 的常用工具不在下面目录中，应直接调用。下面目录只用于发现其余能力（精确 id + 简介），不是参数契约、工作流或调用顺序。执行前先按精确 id 加载最小充分集合，每次最多 ${PROJECT_AGENT_TOOL_LOAD_LIMIT} 个；读取返回的 parameters 后，在后续模型步骤调用 execute_operation。不得猜测参数，也不得直接把目录中的 Operation id 当工具名。已加载项在当前执行段内持续可用。`
    : `Read the full parameter definitions for the Operations needed by the current goal. Common tools already provided directly with complete Schemas are omitted from this catalog and should be called directly. The catalog below discovers only the remaining capabilities (exact id plus summary); it is never an argument contract, workflow, or call order. Before execution, load the smallest sufficient set by exact id, up to ${PROJECT_AGENT_TOOL_LOAD_LIMIT} per call; after reading the returned parameters, call execute_operation in a later model step. Never guess arguments or call a catalog Operation id as a tool name. Loaded Operations remain available for the current execution segment.`
  const catalogLabel = locale === 'zh' ? '能力目录：' : 'Capability catalog:'
  return [introduction, catalogLabel, ...catalogLines].join('\n')
}

export function buildProjectAgentOperationGatewayDescription(
  locale: ProjectAgentLocale,
): string {
  return locale === 'zh'
    ? '执行一个已通过 load_tools 加载的 Operation。operationId 与 contractId 必须精确复制同一条加载结果；argumentsJson 必须是符合返回 parameters 的 JSON 对象字符串。服务端会验证该契约仍属于当前执行段且未过期，再用权威 Operation registry 解析。'
    : 'Execute one Operation already loaded through load_tools. Copy operationId and contractId exactly from the same load result, and pass argumentsJson as a JSON object string matching its parameters. The server verifies that the contract still belongs to this execution segment and is current before parsing through the authoritative Operation registry.'
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
    execute: async (input: unknown): Promise<ProjectAgentToolLoadResult> => (
      await params.state.load(readToolIds(input))
    ),
  }) as Tool<Context>
}
