import { Agent, RunContext, tool, type Tool } from '@openai/agents'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import {
  PROJECT_AGENT_OPERATION_GATEWAY_INPUT_SCHEMA,
  createProjectAgentOperationTools,
  readProjectAgentOperationGatewayInput,
  readProjectAgentOperationGatewayOperationId,
} from '@/lib/project-agent/agents-tool-adapter'
import {
  PROJECT_AGENT_OPERATION_GATEWAY_NAME,
  PROJECT_AGENT_TOOL_DISCOVERY_NAME,
  PROJECT_AGENT_TOOL_LOAD_LIMIT,
  createProjectAgentToolCatalog,
  createProjectAgentToolDiscoveryState,
  createProjectAgentToolDiscoveryTool,
  formatProjectAgentToolNotFound,
} from '@/lib/project-agent/tool-discovery'
import { resolveProjectAgentToolset } from '@/lib/project-agent/toolset'
import { createProjectAgentOperationBatchCoordinator } from '@/lib/project-agent/operation-batch'
import { createInitialProjectAgentRunFence } from '@/lib/project-agent/run-fence'

function createFixture() {
  const registry = createProjectAgentOperationRegistry()
  const toolset = resolveProjectAgentToolset({ registry })
  const catalog = createProjectAgentToolCatalog({ registry, toolset })
  return { registry, toolset, catalog }
}

describe('project agent tool discovery', () => {
  it('keeps the model-visible tool list fixed while returning exact registry schemas as results', async () => {
    const { catalog } = createFixture()
    const state = createProjectAgentToolDiscoveryState({ catalog })
    const loader = createProjectAgentToolDiscoveryTool<Record<string, never>>({
      state,
      locale: 'en',
    })
    const gateway = tool({
      name: PROJECT_AGENT_OPERATION_GATEWAY_NAME,
      description: 'test gateway',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      } as never,
      strict: true,
      execute: () => ({ ok: true }),
    }) as Tool<Record<string, never>>
    const agent = new Agent<Record<string, never>>({
      name: 'tool-discovery-test',
      instructions: 'test',
      tools: [loader, gateway],
    })
    const runContext = new RunContext<Record<string, never>>({})

    expect((await agent.getAllTools(runContext)).map((candidate) => candidate.name)).toEqual([
      PROJECT_AGENT_TOOL_DISCOVERY_NAME,
      PROJECT_AGENT_OPERATION_GATEWAY_NAME,
    ])

    if (loader.type !== 'function') throw new Error('FUNCTION_TOOL_REQUIRED')
    await loader.invoke(runContext, JSON.stringify({
      toolIds: [catalog[0]?.operationId, catalog[1]?.operationId],
    }))
    expect((await agent.getAllTools(runContext)).map((candidate) => candidate.name)).toEqual([
      PROJECT_AGENT_TOOL_DISCOVERY_NAME,
      PROJECT_AGENT_OPERATION_GATEWAY_NAME,
    ])

    const thirdOperationId = catalog[2]?.operationId
    if (!thirdOperationId) throw new Error('TOOL_OPERATION_REQUIRED')
    const result = state.load([thirdOperationId])
    expect((await agent.getAllTools(runContext)).map((candidate) => candidate.name)).toEqual([
      PROJECT_AGENT_TOOL_DISCOVERY_NAME,
      PROJECT_AGENT_OPERATION_GATEWAY_NAME,
    ])
    expect(result.operations).toEqual([{
      operationId: thirdOperationId,
      description: catalog[2]?.description,
      parameters: catalog[2]?.parameters,
    }])
    expect(result.executeWith.toolName).toBe(PROJECT_AGENT_OPERATION_GATEWAY_NAME)
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

  it('exposes the registry-declared direct baseline once and rejects its gateway alias', async () => {
    const { registry, toolset, catalog } = createFixture()
    const operationTools = createProjectAgentOperationTools({
      request: new NextRequest('http://localhost/api/project-agent'),
      registry,
      discoveryState: createProjectAgentToolDiscoveryState({ catalog }),
      description: 'test gateway',
      directOperations: toolset.directOperationIds.map((operationId) => {
        const operation = registry[operationId]
        if (!operation) throw new Error(`TEST_OPERATION_MISSING:${operationId}`)
        return { operation, description: operation.summary }
      }),
      projectId: 'project-1',
      userId: 'user-1',
      context: {
        runId: 'run-1',
        executionSegmentId: 'segment-1',
        locale: 'en',
      },
      runFence: createInitialProjectAgentRunFence('run-1'),
      operationSignal: new AbortController().signal,
      billingConfirmationRequired: true,
      operationBatch: createProjectAgentOperationBatchCoordinator({ originRunId: 'run-1' }),
      writer: {
        write: () => undefined,
        merge: () => {
          throw new Error('TEST_WRITER_MERGE_UNSUPPORTED')
        },
        onError: (error) => error instanceof Error ? error.message : String(error),
      },
    })

    expect(operationTools.map((candidate) => candidate.name)).toEqual([
      PROJECT_AGENT_OPERATION_GATEWAY_NAME,
      ...toolset.directOperationIds,
    ])
    for (const operationId of toolset.directOperationIds) {
      const directTool = operationTools.find((candidate) => candidate.name === operationId)
      if (directTool?.type !== 'function') throw new Error(`FUNCTION_TOOL_REQUIRED:${operationId}`)
      expect(directTool.parameters).toEqual(registry[operationId]?.toolInputSchema)
    }

    const gateway = operationTools[0]
    if (gateway?.type !== 'function') throw new Error('FUNCTION_TOOL_REQUIRED')
    const result = await gateway.invoke(
      new RunContext({}),
      JSON.stringify({
        operationId: 'update_plan',
        argumentsJson: JSON.stringify({ explanation: null, plan: [] }),
      }),
      {
        toolCall: {
          type: 'function_call',
          callId: 'gateway-direct-alias',
          name: PROJECT_AGENT_OPERATION_GATEWAY_NAME,
          arguments: '{}',
        },
      },
    )
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'OPERATION_INPUT_INVALID',
        message: 'PROJECT_AGENT_OPERATION_DIRECT_TOOL_REQUIRED:update_plan',
      },
    })
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

  it('keeps the execution envelope provider-safe and parses only JSON objects', () => {
    expect(PROJECT_AGENT_OPERATION_GATEWAY_INPUT_SCHEMA).toEqual({
      type: 'object',
      properties: {
        operationId: expect.objectContaining({ type: 'string' }),
        argumentsJson: expect.objectContaining({ type: 'string' }),
      },
      required: ['operationId', 'argumentsJson'],
      additionalProperties: false,
    })
    expect(JSON.stringify(PROJECT_AGENT_OPERATION_GATEWAY_INPUT_SCHEMA)).not.toContain('"oneOf"')
    expect(readProjectAgentOperationGatewayInput({
      operationId: 'get_project_context',
      argumentsJson: '{"scope":"project"}',
    })).toEqual({
      operationId: 'get_project_context',
      arguments: { scope: 'project' },
    })
    expect(() => readProjectAgentOperationGatewayInput({
      operationId: 'get_project_context',
      argumentsJson: '[]',
    })).toThrow('PROJECT_AGENT_OPERATION_GATEWAY_ARGUMENTS_OBJECT_REQUIRED:get_project_context')
    expect(() => readProjectAgentOperationGatewayInput({
      operationId: 'get_project_context',
      argumentsJson: '{',
    })).toThrow('PROJECT_AGENT_OPERATION_GATEWAY_ARGUMENTS_JSON_INVALID:get_project_context')
    expect(readProjectAgentOperationGatewayOperationId({
      operationId: 'get_project_context',
      argumentsJson: '{',
    })).toBe('get_project_context')
  })

  it('returns a model-visible correction for unloaded or invented tool calls', () => {
    const { catalog } = createFixture()
    const operationId = catalog[0]?.operationId
    if (!operationId) throw new Error('TOOL_OPERATION_REQUIRED')

    expect(formatProjectAgentToolNotFound({
      toolName: operationId,
      catalog,
      locale: 'en',
    })).toContain('then call execute_operation')
    expect(formatProjectAgentToolNotFound({
      toolName: operationId,
      catalog,
      locale: 'zh',
    })).toContain('读取返回的完整 parameters')
    expect(formatProjectAgentToolNotFound({
      toolName: 'invented_operation',
      catalog,
      locale: 'en',
    })).toContain('is not registered')
  })
})
