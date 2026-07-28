import { asSchema } from 'ai'
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

const OMIT_NULLISH_MODEL_VALUE = Symbol('omit-nullish-model-value')

/** 单条纠错里回显 schema 的上限;超过则只给字段路径与 issue 文案。 */
const MAX_CORRECTION_SCHEMA_CHARS = 1_200

function schemaMatchesDiscriminator(value: unknown, schema: JsonValue): boolean {
  if (!isRecord(schema)) return true
  if (Object.prototype.hasOwnProperty.call(schema, 'const')) return value === schema.const
  if (!isRecord(value)) return true
  const properties = readProperties(schema)
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!isRecord(propertySchema) || !Object.prototype.hasOwnProperty.call(propertySchema, 'const')) continue
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue
    if (!schemaMatchesDiscriminator(value[key], propertySchema)) return false
  }
  return true
}

function selectUnionBranch(value: unknown, schema: JsonObject): JsonValue | null {
  const branches = Array.isArray(schema.oneOf)
    ? schema.oneOf
    : Array.isArray(schema.anyOf)
      ? schema.anyOf
      : []
  if (branches.length === 0) return null
  const matches = branches.filter((branch) => schemaMatchesDiscriminator(value, toJsonValue(branch)))
  return matches.length === 1 ? toJsonValue(matches[0]) : null
}

function normalizeNullableModelValue(
  value: unknown,
  toolSchema: JsonValue,
  runtimeSchema: JsonValue | undefined,
): unknown | typeof OMIT_NULLISH_MODEL_VALUE {
  if (value === null) {
    return schemaAllowsNull(toolSchema)
      && runtimeSchema !== undefined
      && !schemaAllowsNull(runtimeSchema)
      ? OMIT_NULLISH_MODEL_VALUE
      : value
  }
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (!isRecord(toolSchema) || toolSchema.items === undefined) return item
      const runtimeItems = isRecord(runtimeSchema) && runtimeSchema.items !== undefined
        ? toJsonValue(runtimeSchema.items)
        : undefined
      const normalized = normalizeNullableModelValue(
        item,
        toJsonValue(toolSchema.items),
        runtimeItems,
      )
      return normalized === OMIT_NULLISH_MODEL_VALUE ? item : normalized
    })
  }
  if (!isRecord(value) || !isRecord(toolSchema)) return value
  const selectedToolBranch = selectUnionBranch(value, toolSchema)
  const selectedRuntimeBranch = isRecord(runtimeSchema)
    ? selectUnionBranch(value, runtimeSchema)
    : null
  if (selectedToolBranch || selectedRuntimeBranch) {
    return normalizeNullableModelValue(
      value,
      selectedToolBranch ?? toolSchema,
      selectedRuntimeBranch ?? runtimeSchema,
    )
  }
  const properties = readProperties(toolSchema)
  const runtimeProperties = isRecord(runtimeSchema) ? readProperties(runtimeSchema) : {}
  const normalized: UnknownRecord = {}
  for (const [key, child] of Object.entries(value)) {
    const propertySchema = properties[key]
    if (propertySchema === undefined) {
      normalized[key] = child
      continue
    }
    const next = normalizeNullableModelValue(child, propertySchema, runtimeProperties[key])
    if (next !== OMIT_NULLISH_MODEL_VALUE) normalized[key] = next
  }
  return normalized
}

/**
 * Strict tool schemas must list every property. Optional runtime fields are
 * therefore exposed to the model as nullable, but the canonical Zod runtime
 * schema still models absence as undefined. Preserve real null values when
 * Zod accepts them; otherwise, and only for a tool-schema property that
 * explicitly permits null, normalize null to absence before the same Zod
 * parser validates the request.
 */
export function normalizeProjectAgentToolInput(params: {
  input: unknown
  inputSchema: RuntimeSchema<unknown>
  toolInputSchema: ProjectAgentToolInputSchema
}): unknown {
  if (params.inputSchema.safeParse(params.input).success) return params.input
  const rawRuntimeSchema = asSchema(params.inputSchema).jsonSchema
  if (isPromiseLike(rawRuntimeSchema)) return params.input
  const runtimeSchema = toJsonObject(rawRuntimeSchema, 'runtime-normalization')
  const normalized = normalizeNullableModelValue(params.input, {
    type: params.toolInputSchema.type,
    properties: params.toolInputSchema.properties,
    required: params.toolInputSchema.required,
    additionalProperties: params.toolInputSchema.additionalProperties,
  }, runtimeSchema)
  if (normalized === OMIT_NULLISH_MODEL_VALUE) return params.input
  return params.inputSchema.safeParse(normalized).success ? normalized : params.input
}

export type ProjectAgentToolInputCorrectionAction =
  | 'add_required_field'
  | 'move_unknown_field'
  | 'remove_unknown_field'
  | 'fix_invalid_value'

export interface ProjectAgentToolInputCorrection {
  action: ProjectAgentToolInputCorrectionAction
  fieldPath: string
  message: string
  targetPath?: string
  allowedKeys?: string[]
  expectedSchema?: JsonValue
}

function readIssuePath(issue: UnknownRecord): Array<string | number> {
  if (!Array.isArray(issue.path)) return []
  return issue.path.flatMap((part) => (
    typeof part === 'string' || typeof part === 'number' ? [part] : []
  ))
}

function formatInputPath(path: readonly (string | number)[]): string {
  return path.reduce<string>((result, part) => (
    typeof part === 'number'
      ? `${result}[${String(part)}]`
      : `${result}.${part}`
  ), '$input')
}

function readInputAtPath(input: unknown, path: readonly (string | number)[]): unknown {
  let current = input
  for (const part of path) {
    if (typeof part === 'number') {
      if (!Array.isArray(current)) return undefined
      current = current[part]
      continue
    }
    if (!isRecord(current)) return undefined
    current = current[part]
  }
  return current
}

function readSchemaAtPath(params: {
  schema: JsonValue
  input: unknown
  path: readonly (string | number)[]
}): JsonValue | undefined {
  let currentSchema = params.schema
  let currentInput = params.input
  for (const part of params.path) {
    if (!isRecord(currentSchema)) return undefined
    const selectedBranch = selectUnionBranch(currentInput, currentSchema)
    if (selectedBranch !== null) currentSchema = selectedBranch
    if (!isRecord(currentSchema)) return undefined
    if (typeof part === 'number') {
      if (currentSchema.items === undefined) return undefined
      currentSchema = toJsonValue(currentSchema.items)
      currentInput = Array.isArray(currentInput) ? currentInput[part] : undefined
      continue
    }
    const property = readProperties(currentSchema)[part]
    if (property === undefined) return undefined
    currentSchema = property
    currentInput = isRecord(currentInput) ? currentInput[part] : undefined
  }
  if (isRecord(currentSchema)) {
    return selectUnionBranch(currentInput, currentSchema) ?? currentSchema
  }
  return currentSchema
}

function readAllowedKeys(schema: JsonValue | undefined): string[] | undefined {
  if (!isRecord(schema)) return undefined
  const keys = Object.keys(readProperties(schema))
  return keys.length > 0 ? keys : undefined
}

/**
 * Converts canonical Zod issues into model-correctable instructions without
 * creating a second validation contract. Paths and expected shapes are always
 * projected from the same model-facing schema that accepted the tool call.
 */
export function buildProjectAgentToolInputCorrections(params: {
  input: unknown
  toolInputSchema: ProjectAgentToolInputSchema
  issues: unknown
}): ProjectAgentToolInputCorrection[] {
  const rootSchema = serializeToolInputSchema(params.toolInputSchema)
  const rootProperties = readProperties(rootSchema)
  const corrections: ProjectAgentToolInputCorrection[] = []
  const moveTargets = new Set<string>()
  const issues = Array.isArray(params.issues) ? params.issues : []

  for (const rawIssue of issues) {
    if (!isRecord(rawIssue) || rawIssue.code !== 'unrecognized_keys') continue
    const parentPath = readIssuePath(rawIssue)
    const parentSchema = readSchemaAtPath({
      schema: rootSchema,
      input: params.input,
      path: parentPath,
    })
    for (const key of readStringArray(rawIssue.keys)) {
      const fieldPath = formatInputPath([...parentPath, key])
      const targetPath = `$input.${key}`
      if (
        parentPath.length > 0
        && rootProperties[key] !== undefined
        && readInputAtPath(params.input, [key]) === undefined
      ) {
        moveTargets.add(targetPath)
        corrections.push({
          action: 'move_unknown_field',
          fieldPath,
          targetPath,
          message: `Move ${fieldPath} to ${targetPath}; "${key}" is a top-level sibling of ${Object.keys(rootProperties).filter((rootKey) => rootKey !== key).map((rootKey) => `$input.${rootKey}`).join(' and ')}.`,
          allowedKeys: readAllowedKeys(parentSchema),
          expectedSchema: rootProperties[key],
        })
      } else {
        corrections.push({
          action: 'remove_unknown_field',
          fieldPath,
          message: `Remove ${fieldPath}; it is not allowed at ${formatInputPath(parentPath)}.`,
          allowedKeys: readAllowedKeys(parentSchema),
        })
      }
    }
  }

  for (const rawIssue of issues) {
    if (!isRecord(rawIssue) || rawIssue.code === 'unrecognized_keys') continue
    const path = readIssuePath(rawIssue)
    const fieldPath = formatInputPath(path)
    const expectedSchema = readSchemaAtPath({
      schema: rootSchema,
      input: params.input,
      path,
    })
    const missing = path.length > 0 && readInputAtPath(params.input, path) === undefined
    if (missing && moveTargets.has(fieldPath)) continue
    const parentPath = path.slice(0, -1)
    const parentSchema = readSchemaAtPath({
      schema: rootSchema,
      input: params.input,
      path: parentPath,
    })
    const issueMessage = typeof rawIssue.message === 'string'
      ? rawIssue.message
      : 'Value does not match the operation input schema.'
    // 顶层/大分支失败时把整棵 schema 回贴给模型只会淹没有效指令(实测单条可达 8KB)。
    // 超限时省略 schema 回显,保留精确的字段路径与 issue 文案。
    const serializedSchemaSize = expectedSchema === undefined
      ? 0
      : JSON.stringify(expectedSchema).length
    const includeSchema = expectedSchema !== undefined
      && serializedSchemaSize <= MAX_CORRECTION_SCHEMA_CHARS
    corrections.push({
      action: missing ? 'add_required_field' : 'fix_invalid_value',
      fieldPath,
      message: missing
        ? `Add required field ${fieldPath} at this exact path.`
        : `Fix ${fieldPath}: ${issueMessage}`,
      allowedKeys: readAllowedKeys(parentSchema),
      ...(includeSchema ? { expectedSchema } : {}),
    })
  }

  return corrections
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

  if (Array.isArray(schema.enum)) {
    const type = schema.type
    return {
      ...schema,
      ...(typeof type === 'string'
        ? { type: [type, 'null'] }
        : Array.isArray(type)
          ? { type: Array.from(new Set([...type.filter((item): item is string => typeof item === 'string'), 'null'])) }
          : {}),
      enum: [...schema.enum, null].map(toJsonValue),
    }
  }

  if (Object.prototype.hasOwnProperty.call(schema, 'const')) {
    return {
      anyOf: [
        schema,
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
