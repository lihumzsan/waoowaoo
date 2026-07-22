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

function schemaContainsConst(value: unknown, expected: string): boolean {
  if (Array.isArray(value)) return value.some((item) => schemaContainsConst(item, expected))
  const record = asRecord(value)
  if (!record) return false
  if (record.const === expected) return true
  return Object.values(record).some((item) => schemaContainsConst(item, expected))
}

const GOLDEN_SCREENPLAY = [
  'INT. OBSERVATORY - NIGHT\n',
  'Mara crosses the silent circular room while the same storm turns beyond every window. ',
  'She follows one uninterrupted trail of wet footprints to the central telescope. ',
  'The telescope rotates by itself, revealing a handwritten warning beneath its brass base. ',
  'Mara reads the warning, refuses to leave, and aligns the lens with the single red star. ',
  'The room darkens without a cut. A second set of footprints appears beside hers. ',
  'She completes the alignment and the storm stops at once, but her reflection keeps moving. ',
  'Mara faces the glass and accepts that the observatory has recorded a future version of her. ',
  'She closes the dome, breaks the recording mechanism, and remains in the same room until dawn.',
].join('')

function buildGoldenScreenplayDraft(): unknown {
  return {
    kind: 'screenplay_draft',
    title: 'The Red Observatory',
    logline: 'A lone astronomer confronts her moving reflection during one uninterrupted night.',
    synopsis: 'One continuous observatory scene resolves a supernatural warning without a location change.',
    screenplay: GOLDEN_SCREENPLAY,
    estimatedDurationSeconds: 240,
    assumptions: ['The requested 240 seconds remain one continuous dramatic context.'],
    openQuestions: [],
  }
}

function buildGoldenStyleBible(): unknown {
  return {
    kind: 'style_bible',
    design: {
      mode: 'final',
      styleBible: {
        rawUserStyle: 'restrained ink-wash science fiction',
        styleSummary: 'Restrained monochrome ink-wash science fiction with one red accent.',
        visualStyle: 'Fine ink contours, soft paper grain, measured negative space, and restrained motion.',
        assetImageStyle: {
          lighting: 'Low-key moonlight with a single controlled red practical accent.',
          texture: 'Visible cold-press paper grain and dry-brush shadow edges.',
          composition: 'Architectural wide frames with the protagonist isolated near the optical axis.',
        },
      },
    },
    assumptions: [],
    warnings: [],
  }
}

function buildGoldenChapterPlan(): unknown {
  return {
    kind: 'chapter_plan',
    rationale: 'The user explicitly requested independently recoverable production units after retaining the continuous story context.',
    chapters: [
      {
        chapterIndex: 0,
        title: 'The Warning',
        summary: 'Mara enters, follows the footprints, and discovers the warning.',
        sourceStart: 0,
        sourceEnd: 330,
        targetDurationSec: 120,
      },
      {
        chapterIndex: 1,
        title: 'The Reflection',
        summary: 'Mara completes the alignment and resolves the moving reflection.',
        sourceStart: 330,
        sourceEnd: GOLDEN_SCREENPLAY.length,
        targetDurationSec: 120,
      },
    ],
    assumptions: ['Chapter boundaries are production units, not a change to story continuity.'],
    warnings: [],
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
  if (branches?.length) {
    const nullableBranch = branches.find((branch) => asRecord(branch)?.type === 'null')
    if (nullableBranch) return null
    return generateGoldenStructuredValue(branches[0])
  }
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
  if (schemaContainsConst(schema, 'screenplay_draft')) return JSON.stringify(buildGoldenScreenplayDraft())
  if (schemaContainsConst(schema, 'style_bible')) return JSON.stringify(buildGoldenStyleBible())
  if (schemaContainsConst(schema, 'chapter_plan')) return JSON.stringify(buildGoldenChapterPlan())
  return JSON.stringify(generateGoldenStructuredValue(schema))
}
