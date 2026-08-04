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

function collectNeverProperties(value: unknown, out: string[], path = '#') {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectNeverProperties(item, out, `${path}/${String(index)}`))
    return
  }
  const record = value as Record<string, unknown>
  const properties = record.properties
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    for (const [key, property] of Object.entries(properties)) {
      if (!property || typeof property !== 'object' || Array.isArray(property)) continue
      const not = (property as Record<string, unknown>).not
      if (not && typeof not === 'object' && !Array.isArray(not) && Object.keys(not).length === 0) {
        out.push(`${path}/properties/${key}`)
      }
    }
  }
  for (const [key, child] of Object.entries(record)) {
    collectNeverProperties(child, out, `${path}/${key}`)
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

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export { describe, expect, it } from 'vitest'
export { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
export { collectBooleanEnums, collectConfirmedProperties, collectNeverProperties, collectOptionalProperties, readRecord }
