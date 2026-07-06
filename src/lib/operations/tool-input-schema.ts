import { asSchema } from '@ai-sdk/provider-utils'
import type {
  JsonObject,
  JsonValue,
  ProjectAgentToolInputSchema,
  RuntimeSchema,
} from './types'
import { isOperationEnvironmentInputKey } from './environment-input'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return isRecord(value) && typeof value.then === 'function'
}

function toJsonValue(value: unknown): JsonValue {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(toJsonValue)
  }
  if (isRecord(value)) {
    const out: JsonObject = {}
    for (const [key, child] of Object.entries(value)) {
      if (child !== undefined) out[key] = toJsonValue(child)
    }
    return out
  }
  return null
}

function toJsonObject(value: unknown, operationId: string): JsonObject {
  const json = toJsonValue(value)
  if (!isRecord(json) || Array.isArray(json)) {
    throw new Error(`PROJECT_AGENT_TOOL_INPUT_SCHEMA_NOT_OBJECT:${operationId}`)
  }
  return json
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : [])
}

/**
 * A `z.never()` input field serializes to `{ "not": {} }`. Such fields are
 * execution-layer guards that forbid a value entirely, so they must never be
 * exposed to the model: strict-mode normalization would otherwise publish them
 * as required-but-unsatisfiable parameters and bait the model into filling
 * them. Zod validation on the execute path still rejects any value that
 * bypasses the tool schema.
 */
function isNeverSchema(value: unknown): boolean {
  if (!isRecord(value)) return false
  const not = value.not
  return isRecord(not) && Object.keys(not).length === 0
}

function readProperties(schema: JsonObject): Record<string, JsonValue> {
  const value = schema.properties
  if (!isRecord(value) || Array.isArray(value)) return {}
  const out: Record<string, JsonValue> = {}
  for (const [key, property] of Object.entries(value)) {
    if (key === 'confirmed' || key === 'confirmedMaxCost') continue
    if (isOperationEnvironmentInputKey(key)) continue
    if (isNeverSchema(property)) continue
    out[key] = toJsonValue(property)
  }
  return out
}

function schemaAllowsNull(schema: JsonValue): boolean {
  if (!isRecord(schema)) return schema === null
  const type = schema.type
  if (type === 'null') return true
  if (Array.isArray(type) && type.includes('null')) return true
  const enumValues = schema.enum
  if (Array.isArray(enumValues) && enumValues.includes(null)) return true
  const anyOf = schema.anyOf
  if (Array.isArray(anyOf) && anyOf.some(schemaAllowsNull)) return true
  const oneOf = schema.oneOf
  return Array.isArray(oneOf) && oneOf.some(schemaAllowsNull)
}

function addNullable(schema: JsonValue): JsonValue {
  if (schemaAllowsNull(schema)) return schema
  if (!isRecord(schema)) {
    return {
      anyOf: [
        { const: schema },
        { type: 'null' },
      ],
    }
  }

  if (typeof schema.type === 'string') {
    return {
      ...schema,
      type: [schema.type, 'null'],
    }
  }

  if (Array.isArray(schema.type)) {
    return {
      ...schema,
      type: Array.from(new Set([...schema.type.filter((item): item is string => typeof item === 'string'), 'null'])),
    }
  }

  if (Array.isArray(schema.enum)) {
    return {
      ...schema,
      enum: [...schema.enum, null].map(toJsonValue),
    }
  }

  return {
    anyOf: [
      schema,
      { type: 'null' },
    ],
  }
}

function normalizeSchemaNode(value: JsonValue, optional: boolean): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeSchemaNode(item, false))
  }
  if (!isRecord(value)) return optional ? addNullable(value) : value

  const node: JsonObject = {}
  for (const [key, child] of Object.entries(value)) {
    if (key === 'properties' || key === 'required' || key === 'additionalProperties') continue
    node[key] = normalizeSchemaNode(child, false)
  }

  const properties = readProperties(value)
  const propertyKeys = Object.keys(properties)
  const originallyRequired = new Set(readStringArray(value.required))
  if (propertyKeys.length > 0 || value.type === 'object' || isRecord(value.properties)) {
    const normalizedProperties: Record<string, JsonValue> = {}
    for (const [key, child] of Object.entries(properties)) {
      normalizedProperties[key] = normalizeSchemaNode(child, !originallyRequired.has(key))
    }
    node.type = 'object'
    node.properties = normalizedProperties
    node.required = propertyKeys
    node.additionalProperties = false
  }

  if (Array.isArray(value.anyOf)) {
    node.anyOf = value.anyOf.map((item) => normalizeSchemaNode(toJsonValue(item), false))
  }
  if (Array.isArray(value.oneOf)) {
    node.oneOf = value.oneOf.map((item) => normalizeSchemaNode(toJsonValue(item), false))
  }
  if (Array.isArray(value.allOf)) {
    node.allOf = value.allOf.map((item) => normalizeSchemaNode(toJsonValue(item), false))
  }
  if (value.items !== undefined) {
    node.items = normalizeSchemaNode(toJsonValue(value.items), false)
  }

  return optional ? addNullable(node) : node
}

function assertNoForbiddenToolSchemaSurface(params: {
  operationId: string
  path: string
  value: JsonValue
}): void {
  const { operationId, path, value } = params
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenToolSchemaSurface({
      operationId,
      path: `${path}/${String(index)}`,
      value: item,
    }))
    return
  }
  if (!isRecord(value)) return

  const properties = value.properties
  if (
    isRecord(properties)
    && (
      Object.prototype.hasOwnProperty.call(properties, 'confirmed')
      || Object.prototype.hasOwnProperty.call(properties, 'confirmedMaxCost')
      || Object.keys(properties).some(isOperationEnvironmentInputKey)
    )
  ) {
    throw new Error(`PROJECT_AGENT_TOOL_INPUT_SCHEMA_INTERNAL_FIELD_EXPOSED:${operationId}:${path}`)
  }
  if (isRecord(properties)) {
    for (const [propertyKey, propertySchema] of Object.entries(properties)) {
      if (isNeverSchema(propertySchema)) {
        throw new Error(`PROJECT_AGENT_TOOL_INPUT_SCHEMA_NEVER_EXPOSED:${operationId}:${path}/${propertyKey}`)
      }
    }
  }

  const required = readStringArray(value.required)
  const propertyKeys = isRecord(properties) ? Object.keys(properties) : []
  for (const key of propertyKeys) {
    if (!required.includes(key)) {
      throw new Error(`PROJECT_AGENT_TOOL_INPUT_SCHEMA_OPTIONAL_PROPERTY:${operationId}:${path}/${key}`)
    }
  }

  for (const [key, child] of Object.entries(value)) {
    assertNoForbiddenToolSchemaSurface({
      operationId,
      path: `${path}/${key}`,
      value: toJsonValue(child),
    })
  }
}

function serializeToolInputSchema(schema: ProjectAgentToolInputSchema): JsonObject {
  return {
    type: schema.type,
    properties: schema.properties,
    required: schema.required,
    additionalProperties: schema.additionalProperties,
    ...(typeof schema.description === 'string' ? { description: schema.description } : {}),
  }
}

export function createProjectAgentToolInputSchema(params: {
  operationId: string
  inputSchema: RuntimeSchema<unknown>
  explicitToolInputSchema?: ProjectAgentToolInputSchema
}): ProjectAgentToolInputSchema {
  if (params.explicitToolInputSchema) {
    assertNoForbiddenToolSchemaSurface({
      operationId: params.operationId,
      path: '#',
      value: serializeToolInputSchema(params.explicitToolInputSchema),
    })
    return params.explicitToolInputSchema
  }

  const rawJsonSchema = asSchema(params.inputSchema).jsonSchema
  if (isPromiseLike(rawJsonSchema)) {
    throw new Error(`PROJECT_AGENT_TOOL_INPUT_SCHEMA_ASYNC_UNSUPPORTED:${params.operationId}`)
  }
  const root = toJsonObject(rawJsonSchema, params.operationId)
  const normalized = normalizeSchemaNode(root, false)
  const normalizedRoot = toJsonObject(normalized, params.operationId)
  const properties = readProperties(normalizedRoot)
  const result: ProjectAgentToolInputSchema = {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
    ...(typeof normalizedRoot.description === 'string' ? { description: normalizedRoot.description } : {}),
  }
  assertNoForbiddenToolSchemaSurface({
    operationId: params.operationId,
    path: '#',
    value: serializeToolInputSchema(result),
  })
  return result
}
