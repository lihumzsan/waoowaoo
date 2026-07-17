import { describe, expect, it } from 'vitest'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import { resolveProjectAgentToolset } from '@/lib/project-agent/toolset'
import { CREATIVE_RESOURCE_SCHEMA_IDS_BY_MEDIA } from '@/lib/creative-resource/schema-registry'

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function collectUnboundedSchemaNodes(value: unknown, path: string, out: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectUnboundedSchemaNodes(item, `${path}/${String(index)}`, out))
    return
  }
  if (!value || typeof value !== 'object') return
  const record = readRecord(value)
  if (Object.keys(record).length === 0) {
    out.push(path)
    return
  }
  for (const [key, child] of Object.entries(record)) {
    if (key === 'default') continue
    collectUnboundedSchemaNodes(child, `${path}/${key}`, out)
  }
}

function collectNullableEnumViolations(value: unknown, path: string, out: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectNullableEnumViolations(item, `${path}/${String(index)}`, out))
    return
  }
  const record = readRecord(value)
  const types = Array.isArray(record.type) ? record.type : []
  if (types.includes('null') && Array.isArray(record.enum) && !record.enum.includes(null)) {
    out.push(path)
  }
  for (const [key, child] of Object.entries(record)) {
    collectNullableEnumViolations(child, `${path}/${key}`, out)
  }
}

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

  it('publishes one explicit Resource generation contract from the production registry', () => {
    const registry = createProjectAgentOperationRegistry()
    const operationIds = ['create_text', 'create_image', 'create_audio', 'create_video'] as const
    const mediaTypes = ['text', 'image', 'audio', 'video'] as const

    for (const [index, operationId] of operationIds.entries()) {
      const operation = registry[operationId]
      const properties = operation.toolInputSchema.properties
      const schemaId = readRecord(properties.schemaId)
      expect(schemaId.enum).toEqual([
        ...CREATIVE_RESOURCE_SCHEMA_IDS_BY_MEDIA[mediaTypes[index] ?? 'text'],
        null,
      ])
      expect(Object.keys(properties)).not.toContain('generationOptions')
      expect(Object.keys(properties)).not.toContain('retryResourceIds')
    }

    expect(Object.keys(registry.create_text.toolInputSchema.properties)).toContain('content')
    expect(Object.keys(registry.create_image.toolInputSchema.properties)).toContain('request')
    expect(Object.keys(registry.create_audio.toolInputSchema.properties)).toContain('request')
    expect(Object.keys(registry.create_video.toolInputSchema.properties)).toEqual(expect.arrayContaining([
      'request',
      'durationSeconds',
      'aspectRatio',
      'resolution',
      'fps',
      'generateAudio',
    ]))

    expect(registry.create_text.inputSchema.safeParse({
      prompt: 'Write one line.',
      content: { kind: 'single', text: 'One line.' },
    }).success).toBe(true)
    expect(registry.create_image.inputSchema.safeParse({
      prompt: 'A paper lantern in fog.',
      request: { kind: 'new', count: 2 },
    }).success).toBe(true)
    expect(registry.create_audio.inputSchema.safeParse({
      prompt: 'Sparse ritual drums.',
      request: { kind: 'new', count: 1 },
      durationSeconds: 15,
    }).success).toBe(true)
    expect(registry.create_video.inputSchema.safeParse({
      prompt: 'A slow push toward a moonlit shrine.',
      request: { kind: 'new', count: 1 },
      durationSeconds: 15,
    }).success).toBe(true)
    expect(registry.create_video.inputSchema.safeParse({
      prompt: 'Old provider-shaped input.',
      count: 1,
      generationOptions: { durationSeconds: 15 },
    }).success).toBe(false)
  })

  it('publishes exact retry, segment, task, and model-configuration branches', () => {
    const registry = createProjectAgentOperationRegistry()
    const requestSchema = readRecord(registry.create_video.toolInputSchema.properties.request)
    const requestKinds = (Array.isArray(requestSchema.oneOf) ? requestSchema.oneOf : [])
      .map((branch) => readRecord(readRecord(readRecord(branch).properties).kind).const)
    expect(requestKinds).toEqual(['new', 'retry'])

    const scopeSchema = readRecord(registry.generate_video_segments.toolInputSchema.properties.scope)
    const scopeKinds = (Array.isArray(scopeSchema.oneOf) ? scopeSchema.oneOf : [])
      .map((branch) => readRecord(readRecord(readRecord(branch).properties).kind).const)
    expect(scopeKinds).toEqual(['pending', 'segment'])

    expect(Object.keys(registry.list_tasks.toolInputSchema.properties)).toEqual(expect.arrayContaining([
      'targetType', 'targetId', 'status', 'type', 'limit',
    ]))
    expect(Object.keys(registry.get_task.toolInputSchema.properties)).toEqual([
      'taskId', 'includeEvents', 'eventsLimit',
    ])
    expect(Object.keys(registry.put_user_api_config.toolInputSchema.properties)).toEqual([
      'providers', 'models', 'defaultModels', 'capabilityDefaults', 'workflowConcurrency',
    ])
    expect(Object.keys(registry.update_user_preference.toolInputSchema.properties)).toContain('assistantModel')
    expect(Object.keys(registry.update_project_config.toolInputSchema.properties)).toContain('capabilityOverrides')
  })

  it('contains no anonymous permissive schemas or nullable enums that reject null', () => {
    const registry = createProjectAgentOperationRegistry()
    const unbounded: string[] = []
    const nullableEnumViolations: string[] = []

    for (const operation of Object.values(registry)) {
      if (!operation.channels.tool) continue
      for (const [property, schema] of Object.entries(operation.toolInputSchema.properties)) {
        collectUnboundedSchemaNodes(schema, `${operation.id}/${property}`, unbounded)
      }
      collectNullableEnumViolations(operation.toolInputSchema, operation.id, nullableEnumViolations)
    }

    expect(unbounded).toEqual([])
    expect(nullableEnumViolations).toEqual([])
  })
})
