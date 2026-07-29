import { describe, expect, it } from 'vitest'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import { resolveProjectAgentToolset } from '@/lib/project-agent/toolset'
import { createProjectAgentToolCatalog } from '@/lib/project-agent/tool-discovery'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function collectInvalidSchemaNodes(
  value: unknown,
  path: string,
  invalid: string[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectInvalidSchemaNodes(
      item,
      `${path}/${String(index)}`,
      invalid,
    ))
    return
  }
  if (!value || typeof value !== 'object') return
  const record = asRecord(value)
  if (Object.keys(record).length === 0) invalid.push(`${path}:empty`)
  const types = Array.isArray(record.type) ? record.type : []
  if (types.includes('null') && Array.isArray(record.enum) && !record.enum.includes(null)) {
    invalid.push(`${path}:nullable-enum-rejects-null`)
  }
  for (const [key, child] of Object.entries(record)) {
    if (key !== 'default') collectInvalidSchemaNodes(child, `${path}/${key}`, invalid)
  }
}

describe('project agent registry conformance', () => {
  it('projects every tool-enabled production operation exactly once', () => {
    const registry = createProjectAgentOperationRegistry()
    const toolset = resolveProjectAgentToolset({ registry })
    const expected = Object.values(registry)
      .filter((operation) => operation.channels.tool)
      .map((operation) => operation.id)
      .sort()

    expect(toolset.source).toBe('operation-registry')
    expect(toolset.operationIds).toEqual(expected)
    expect(new Set(toolset.operationIds).size).toBe(expected.length)
    expect([...toolset.directOperationIds, ...toolset.onDemandOperationIds].sort()).toEqual(expected)

    for (const operationId of toolset.directOperationIds) {
      expect(registry[operationId]?.toolExposure).toBe('direct')
    }
    for (const operationId of toolset.onDemandOperationIds) {
      expect(registry[operationId]?.toolExposure).toBe('on_demand')
    }
  })

  it('derives the complete on-demand catalog from the same registry schemas', () => {
    const registry = createProjectAgentOperationRegistry()
    const toolset = resolveProjectAgentToolset({ registry })
    const catalog = createProjectAgentToolCatalog({ registry, toolset })

    expect(catalog.map((entry) => entry.operationId)).toEqual(toolset.onDemandOperationIds)
    for (const entry of catalog) {
      expect(entry.groupPath.length).toBeGreaterThan(0)
      expect(entry.description.length).toBeGreaterThan(0)
      expect(entry.parameters).toBe(registry[entry.operationId]?.toolInputSchema)
    }
  })

  it('publishes no anonymous permissive schema or broken nullable enum', () => {
    const registry = createProjectAgentOperationRegistry()
    const invalid: string[] = []

    for (const operation of Object.values(registry)) {
      if (!operation.channels.tool) continue
      for (const [property, schema] of Object.entries(operation.toolInputSchema.properties)) {
        collectInvalidSchemaNodes(schema, `${operation.id}/${property}`, invalid)
      }
    }

    expect(invalid).toEqual([])
  })
})
