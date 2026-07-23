import { Agent, RunContext, tool, type Tool } from '@openai/agents'
import { describe, expect, it } from 'vitest'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import {
  PROJECT_AGENT_TOOL_DISCOVERY_NAME,
  PROJECT_AGENT_TOOL_LOAD_LIMIT,
  createProjectAgentToolCatalog,
  createProjectAgentToolDiscoveryState,
  createProjectAgentToolDiscoveryTool,
  formatProjectAgentToolNotFound,
} from '@/lib/project-agent/tool-discovery'
import { resolveProjectAgentToolset } from '@/lib/project-agent/toolset'

function createFixture() {
  const registry = createProjectAgentOperationRegistry()
  const toolset = resolveProjectAgentToolset({ registry })
  const catalog = createProjectAgentToolCatalog({ registry, toolset })
  return { catalog }
}

describe('project agent tool discovery', () => {
  it('exposes only the loader, then accumulates exact requested schemas between model steps', async () => {
    const { catalog } = createFixture()
    const state = createProjectAgentToolDiscoveryState({ catalog })
    const loader = createProjectAgentToolDiscoveryTool<Record<string, never>>({
      state,
      locale: 'en',
    })
    const operationTools = catalog.slice(0, 3).map((entry) => tool({
      name: entry.operationId,
      description: entry.description,
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      } as never,
      strict: true,
      isEnabled: () => state.isLoaded(entry.operationId),
      execute: () => ({ ok: true }),
    }) as Tool<Record<string, never>>)
    const agent = new Agent<Record<string, never>>({
      name: 'tool-discovery-test',
      instructions: 'test',
      tools: [loader, ...operationTools],
    })
    const runContext = new RunContext<Record<string, never>>({})

    expect((await agent.getAllTools(runContext)).map((candidate) => candidate.name)).toEqual([
      PROJECT_AGENT_TOOL_DISCOVERY_NAME,
    ])

    if (loader.type !== 'function') throw new Error('FUNCTION_TOOL_REQUIRED')
    await loader.invoke(runContext, JSON.stringify({
      toolIds: [catalog[0]?.operationId, catalog[1]?.operationId],
    }))
    expect((await agent.getAllTools(runContext)).map((candidate) => candidate.name)).toEqual([
      PROJECT_AGENT_TOOL_DISCOVERY_NAME,
      catalog[0]?.operationId,
      catalog[1]?.operationId,
    ])

    await loader.invoke(runContext, JSON.stringify({ toolIds: [catalog[2]?.operationId] }))
    expect((await agent.getAllTools(runContext)).map((candidate) => candidate.name)).toEqual([
      PROJECT_AGENT_TOOL_DISCOVERY_NAME,
      catalog[0]?.operationId,
      catalog[1]?.operationId,
      catalog[2]?.operationId,
    ])
  })

  it('preloads exact approval-resume operations without opening the rest of the catalog', () => {
    const { catalog } = createFixture()
    const approvalOperationId = catalog[1]?.operationId
    if (!approvalOperationId) throw new Error('APPROVAL_OPERATION_REQUIRED')
    const state = createProjectAgentToolDiscoveryState({
      catalog,
      initiallyLoadedOperationIds: [approvalOperationId],
    })

    expect(state.loadedOperationIds()).toEqual([approvalOperationId])
    expect(state.isLoaded(approvalOperationId)).toBe(true)
    expect(catalog.filter((entry) => state.isLoaded(entry.operationId))).toHaveLength(1)
  })

  it('fails explicitly for unknown, duplicate, or oversized load requests', () => {
    const { catalog } = createFixture()
    const state = createProjectAgentToolDiscoveryState({ catalog })
    const firstOperationId = catalog[0]?.operationId
    if (!firstOperationId) throw new Error('TOOL_OPERATION_REQUIRED')

    expect(() => state.load(['unknown_operation'])).toThrow(
      'PROJECT_AGENT_TOOL_LOAD_ID_UNKNOWN:unknown_operation',
    )
    expect(() => state.load([firstOperationId, firstOperationId])).toThrow(
      'PROJECT_AGENT_TOOL_LOAD_ID_DUPLICATE',
    )
    expect(() => state.load(
      catalog.slice(0, PROJECT_AGENT_TOOL_LOAD_LIMIT + 1).map((entry) => entry.operationId),
    )).toThrow(`PROJECT_AGENT_TOOL_LOAD_COUNT_INVALID:${PROJECT_AGENT_TOOL_LOAD_LIMIT + 1}`)
  })

  it('returns a model-visible correction for unloaded or invented tool calls', () => {
    const { catalog } = createFixture()
    const operationId = catalog[0]?.operationId
    if (!operationId) throw new Error('TOOL_OPERATION_REQUIRED')

    expect(formatProjectAgentToolNotFound({
      toolName: operationId,
      catalog,
      locale: 'en',
    })).toContain(`Load this exact id with load_tools`)
    expect(formatProjectAgentToolNotFound({
      toolName: operationId,
      catalog,
      locale: 'zh',
    })).toContain('等待下一模型步骤出现完整 Schema')
    expect(formatProjectAgentToolNotFound({
      toolName: 'invented_operation',
      catalog,
      locale: 'en',
    })).toContain('is not registered')
  })
})
