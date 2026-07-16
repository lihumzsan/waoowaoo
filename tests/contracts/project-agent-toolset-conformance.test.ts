import { describe, expect, it } from 'vitest'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import { resolveProjectAgentToolset } from '@/lib/project-agent/toolset'

describe('project agent toolset conformance', () => {
  it('exposes every tool-authorized Operation directly from the production registry', () => {
    const registry = createProjectAgentOperationRegistry()
    const expectedOperationIds = Object.values(registry)
      .filter((operation) => operation.channels.tool)
      .map((operation) => operation.id)
      .sort()

    const toolset = resolveProjectAgentToolset({ registry })

    expect(toolset.source).toBe('operation-registry')
    expect(toolset.disabledOperationIds).toEqual([])
    expect(toolset.operationIds).toEqual(expectedOperationIds)
  })

  it('can suppress only explicitly named continuation-local tools without changing registry authority', () => {
    const registry = createProjectAgentOperationRegistry()
    const disabledOperationId = Object.values(registry)
      .find((operation) => operation.channels.tool)?.id
    if (!disabledOperationId) throw new Error('TOOL_OPERATION_REQUIRED')

    const toolset = resolveProjectAgentToolset({
      registry,
      disabledOperationIds: [disabledOperationId],
    })

    expect(toolset.disabledOperationIds).toEqual([disabledOperationId])
    expect(toolset.operationIds).not.toContain(disabledOperationId)
    expect(toolset.operationIds).toEqual(
      Object.values(registry)
        .filter((operation) => operation.channels.tool && operation.id !== disabledOperationId)
        .map((operation) => operation.id)
        .sort(),
    )
  })
})
