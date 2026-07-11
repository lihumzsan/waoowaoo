function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readSchemaFromResponseFormat(value: unknown): unknown {
  const format = asRecord(value)
  if (!format || format.type !== 'json_schema') return null
  const jsonSchema = asRecord(format.json_schema)
  return jsonSchema?.schema ?? null
}

function isScriptIntakeSchema(schemaValue: unknown): boolean {
  const schema = asRecord(schemaValue)
  const properties = asRecord(schema?.properties)
  const questions = asRecord(properties?.questions)
  const items = asRecord(questions?.items)
  const itemProperties = asRecord(items?.properties)
  return Boolean(itemProperties?.key && itemProperties?.label && itemProperties?.options)
}

export function buildGoldenScriptIntakePlan(): unknown {
  return {
    questions: [
      {
        key: 'targetRuntime',
        label: '目标时长',
        options: [
          { value: 'one_minute', label: '1分钟', description: '适合一个强钩子和一次清晰反转。' },
          { value: 'three_minutes', label: '3分钟', description: '适合完整起承转合并完成收束。' },
          { value: 'five_minutes', label: '5分钟', description: '适合多段冲突和较完整的结尾。' },
          { value: 'ten_minutes', label: '10分钟', description: '适合慢铺垫、多场景和完整人物弧光。' },
        ],
      },
      {
        key: 'genreTone',
        label: '类型基调',
        options: [
          { value: 'folk_horror', label: '民俗恐怖', description: '禁忌、仪式与乡土传说。' },
          { value: 'psychological_horror', label: '心理恐怖', description: '不可靠感知与逐步失控。' },
        ],
      },
      {
        key: 'endingDirection',
        label: '结局走向',
        options: [
          { value: 'closed_loop', label: '循环重启', description: '主角以为逃脱，却回到起点。' },
          { value: 'costly_escape', label: '代价逃生', description: '主角脱身但付出不可逆代价。' },
        ],
      },
    ],
  }
}

function selectSchemaBranch(schema: Record<string, unknown>): unknown {
  for (const key of ['const', 'enum', 'default', 'examples'] as const) {
    const value = schema[key]
    if (key === 'enum' || key === 'examples') {
      if (Array.isArray(value) && value.length > 0) return value[0]
      continue
    }
    if (value !== undefined) return value
  }
  const branches = Array.isArray(schema.anyOf)
    ? schema.anyOf
    : Array.isArray(schema.oneOf)
      ? schema.oneOf
      : null
  if (branches?.length) return generateGoldenStructuredValue(branches[0])
  return undefined
}

function generateObject(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = asRecord(schema.properties) ?? {}
  const required = new Set(Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === 'string')
    : Object.keys(properties))
  const output: Record<string, unknown> = {}
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!required.has(key)) continue
    output[key] = generateGoldenStructuredValue(propertySchema)
  }
  return output
}

export function generateGoldenStructuredValue(schemaValue: unknown): unknown {
  const schema = asRecord(schemaValue)
  if (!schema) return {}
  const selected = selectSchemaBranch(schema)
  if (selected !== undefined) return selected
  const type = Array.isArray(schema.type)
    ? schema.type.find((candidate) => candidate !== 'null')
    : schema.type
  if (type === 'object' || schema.properties) return generateObject(schema)
  if (type === 'array' || schema.items) {
    const minItems = typeof schema.minItems === 'number' && schema.minItems > 0
      ? Math.ceil(schema.minItems)
      : 1
    return Array.from({ length: minItems }, () => generateGoldenStructuredValue(schema.items))
  }
  if (type === 'integer' || type === 'number') {
    if (typeof schema.minimum === 'number') return schema.minimum
    return 1
  }
  if (type === 'boolean') return false
  if (type === 'null') return null
  return 'golden-test-value'
}

export function generateGoldenResponseFormatText(responseFormat: unknown): string | null {
  const schema = readSchemaFromResponseFormat(responseFormat)
  if (!schema) return null
  if (isScriptIntakeSchema(schema)) return JSON.stringify(buildGoldenScriptIntakePlan())
  return JSON.stringify(generateGoldenStructuredValue(schema))
}
