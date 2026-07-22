import type { JsonSchemaDefinition } from '@openai/agents'
import { z } from 'zod'
import type { CreativeWorkOutputKind } from './types'

type JsonRecord = Record<string, unknown>

const UNSUPPORTED_STRUCTURED_OUTPUT_KEYWORDS = new Set([
  '$schema',
  'contains',
  'default',
  'exclusiveMaximum',
  'exclusiveMinimum',
  'format',
  'maxContains',
  'maxItems',
  'maxLength',
  'maxProperties',
  'maximum',
  'minContains',
  'minItems',
  'minLength',
  'minProperties',
  'minimum',
  'multipleOf',
  'pattern',
  'patternProperties',
  'propertyNames',
  'unevaluatedItems',
  'unevaluatedProperties',
  'uniqueItems',
])

function readJsonRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function allowsNull(value: unknown): boolean {
  const record = readJsonRecord(value)
  if (!record) return false
  if (record.type === 'null') return true
  if (Array.isArray(record.type) && record.type.includes('null')) return true
  return Array.isArray(record.anyOf) && record.anyOf.some(allowsNull)
}

function makeNullable(value: unknown): unknown {
  return allowsNull(value)
    ? value
    : { anyOf: [value, { type: 'null' }] }
}

function sanitizeStructuredOutputNode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeStructuredOutputNode)
  const record = readJsonRecord(value)
  if (!record) return value

  const sanitized: JsonRecord = {}
  for (const [key, child] of Object.entries(record)) {
    if (UNSUPPORTED_STRUCTURED_OUTPUT_KEYWORDS.has(key)) continue
    if (key === 'const') {
      if (!Object.hasOwn(record, 'enum')) {
        sanitized.enum = [sanitizeStructuredOutputNode(child)]
      }
      continue
    }
    if (key === 'oneOf') {
      sanitized.anyOf = sanitizeStructuredOutputNode(child)
      continue
    }
    if (key === 'properties') {
      const properties = readJsonRecord(child)
      if (!properties) continue
      const required = new Set(Array.isArray(record.required)
        ? record.required.filter((entry): entry is string => typeof entry === 'string')
        : [])
      sanitized.properties = Object.fromEntries(Object.entries(properties).map(([property, schema]) => {
        const propertySchema = sanitizeStructuredOutputNode(schema)
        return [property, required.has(property) ? propertySchema : makeNullable(propertySchema)]
      }))
      sanitized.required = Object.keys(properties)
      continue
    }
    if (key === 'required' && record.type === 'object') continue
    sanitized[key] = sanitizeStructuredOutputNode(child)
  }
  return sanitized
}

function schemaMatchesValue(schema: unknown, value: unknown): boolean {
  const record = readJsonRecord(schema)
  if (!record) return false
  if (Object.hasOwn(record, 'const')) return Object.is(record.const, value)
  if (Array.isArray(record.enum)) return record.enum.some((candidate) => Object.is(candidate, value))
  if (record.type === 'null') return value === null
  if (record.type === 'array') return Array.isArray(value)
  if (record.type === 'object') {
    const objectValue = readJsonRecord(value)
    if (!objectValue) return false
    const properties = readJsonRecord(record.properties) ?? {}
    return Object.entries(properties).every(([property, propertySchema]) => {
      const propertyRecord = readJsonRecord(propertySchema)
      if (propertyRecord && Object.hasOwn(propertyRecord, 'const')) {
        return Object.is(propertyRecord.const, objectValue[property])
      }
      if (!propertyRecord || !Array.isArray(propertyRecord.enum)) return true
      return propertyRecord.enum.some((candidate) => Object.is(candidate, objectValue[property]))
    })
  }
  if (record.type === 'string') return typeof value === 'string'
  if (record.type === 'number' || record.type === 'integer') return typeof value === 'number'
  if (record.type === 'boolean') return typeof value === 'boolean'
  return true
}

function normalizeTransportValue(schema: unknown, value: unknown): unknown {
  const record = readJsonRecord(schema)
  if (!record) return value
  const branches = Array.isArray(record.anyOf)
    ? record.anyOf
    : Array.isArray(record.oneOf)
      ? record.oneOf
      : null
  if (branches) {
    const branch = branches.find((candidate) => schemaMatchesValue(candidate, value))
    return branch ? normalizeTransportValue(branch, value) : value
  }
  if (record.type === 'array' && Array.isArray(value)) {
    return value.map((entry) => normalizeTransportValue(record.items, entry))
  }
  if (record.type !== 'object') return value
  const objectValue = readJsonRecord(value)
  const properties = readJsonRecord(record.properties)
  if (!objectValue || !properties) return value
  const required = new Set(Array.isArray(record.required)
    ? record.required.filter((entry): entry is string => typeof entry === 'string')
    : [])
  return Object.fromEntries(Object.entries(objectValue).flatMap(([property, propertyValue]) => {
    const propertySchema = properties[property]
    if (!propertySchema) return [[property, propertyValue]]
    if (propertyValue === null && !required.has(property)) return []
    return [[property, normalizeTransportValue(propertySchema, propertyValue)]]
  }))
}

function assertStrictObjectShapes(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertStrictObjectShapes(child, `${path}[${String(index)}]`))
    return
  }
  const record = readJsonRecord(value)
  if (!record) return
  if (record.type === 'object') {
    const properties = readJsonRecord(record.properties)
    if (!properties) throw new Error(`CREATIVE_WORK_TRANSPORT_SCHEMA_PROPERTIES_REQUIRED:${path}`)
    const required = Array.isArray(record.required)
      ? record.required.filter((entry): entry is string => typeof entry === 'string')
      : []
    const propertyNames = Object.keys(properties)
    if (
      required.length !== propertyNames.length
      || propertyNames.some((property) => !required.includes(property))
    ) {
      throw new Error(`CREATIVE_WORK_TRANSPORT_SCHEMA_ALL_FIELDS_REQUIRED:${path}`)
    }
    if (record.additionalProperties !== false) {
      throw new Error(`CREATIVE_WORK_TRANSPORT_SCHEMA_ADDITIONAL_PROPERTIES_FORBIDDEN:${path}`)
    }
  }
  for (const [key, child] of Object.entries(record)) {
    assertStrictObjectShapes(child, `${path}.${key}`)
  }
}

export function buildCreativeWorkerOutputTransportSchema(input: {
  readonly kind: CreativeWorkOutputKind
  readonly schema: z.ZodObject
}): JsonSchemaDefinition {
  const generated = z.toJSONSchema(input.schema, { target: 'draft-7' })
  const sanitized = sanitizeStructuredOutputNode(generated)
  const root = readJsonRecord(sanitized)
  if (!root || root.type !== 'object') {
    throw new Error(`CREATIVE_WORK_TRANSPORT_SCHEMA_ROOT_INVALID:${input.kind}`)
  }
  assertStrictObjectShapes(root, '$')
  return {
    type: 'json_schema',
    name: `creative_${input.kind}`,
    strict: true,
    schema: root as JsonSchemaDefinition['schema'],
  }
}

export function normalizeCreativeWorkerOutputFromTransport(input: {
  readonly schema: z.ZodObject
  readonly value: unknown
}): unknown {
  const generated = z.toJSONSchema(input.schema, { target: 'draft-7' })
  return normalizeTransportValue(generated, input.value)
}
