import { describe, expect, it } from 'vitest'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'

function collectBooleanEnums(value: unknown, out: unknown[][]) {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) collectBooleanEnums(item, out)
    return
  }
  const record = value as Record<string, unknown>
  if (Array.isArray(record.enum) && record.enum.some((item) => typeof item === 'boolean')) {
    out.push(record.enum)
  }
  for (const child of Object.values(record)) {
    collectBooleanEnums(child, out)
  }
}

function collectConfirmedProperties(value: unknown, out: string[], path = '#') {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectConfirmedProperties(item, out, `${path}/${String(index)}`))
    return
  }
  const record = value as Record<string, unknown>
  const properties = record.properties
  if (properties && typeof properties === 'object' && !Array.isArray(properties) && 'confirmed' in properties) {
    out.push(`${path}/properties/confirmed`)
  }
  for (const [key, child] of Object.entries(record)) {
    collectConfirmedProperties(child, out, `${path}/${key}`)
  }
}

function collectOptionalProperties(value: unknown, out: string[], path = '#') {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectOptionalProperties(item, out, `${path}/${String(index)}`))
    return
  }
  const record = value as Record<string, unknown>
  const properties = record.properties
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    const required = Array.isArray(record.required)
      ? record.required.filter((item): item is string => typeof item === 'string')
      : []
    for (const key of Object.keys(properties)) {
      if (!required.includes(key)) out.push(`${path}/properties/${key}`)
    }
  }
  for (const [key, child] of Object.entries(record)) {
    collectOptionalProperties(child, out, `${path}/${key}`)
  }
}

describe('tool input schema compatibility', () => {
  it('does not emit boolean enum values in tool parameter schemas', () => {
    const registry = createProjectAgentOperationRegistry()
    const violations: Array<{ id: string; enum: unknown[] }> = []
    for (const operation of Object.values(registry)) {
      if (!operation.channels.tool) continue
      const enums: unknown[][] = []
      collectBooleanEnums(operation.toolInputSchema, enums)
      for (const e of enums) {
        violations.push({ id: operation.id, enum: e })
      }
    }
    expect(violations).toEqual([])
  })

  it('does not expose internal confirmation fields in model-facing tool schemas', () => {
    const registry = createProjectAgentOperationRegistry()
    const violations: Array<{ id: string; path: string }> = []
    for (const operation of Object.values(registry)) {
      if (!operation.channels.tool) continue
      const paths: string[] = []
      collectConfirmedProperties(operation.toolInputSchema, paths)
      for (const path of paths) {
        violations.push({ id: operation.id, path })
      }
    }
    expect(violations).toEqual([])
  })

  it('makes every model-facing tool property required for OpenAI strict schema conversion', () => {
    const registry = createProjectAgentOperationRegistry()
    const violations: Array<{ id: string; path: string }> = []
    for (const operation of Object.values(registry)) {
      if (!operation.channels.tool) continue
      const paths: string[] = []
      collectOptionalProperties(operation.toolInputSchema, paths)
      for (const path of paths) {
        violations.push({ id: operation.id, path })
      }
    }
    expect(violations).toEqual([])
  })
})
