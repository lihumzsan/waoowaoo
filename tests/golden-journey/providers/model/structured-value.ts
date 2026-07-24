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

function schemaContainsLiteral(value: unknown, expected: string): boolean {
  if (Array.isArray(value)) return value.some((item) => schemaContainsLiteral(item, expected))
  const record = asRecord(value)
  if (!record) return false
  if (record.const === expected) return true
  if (Array.isArray(record.enum) && record.enum.includes(expected)) return true
  return Object.values(record).some((item) => schemaContainsLiteral(item, expected))
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

function buildGoldenScreenplay(): unknown {
  return {
    kind: 'screenplay',
    title: 'The Red Observatory',
    logline: 'A lone astronomer confronts her moving reflection during one uninterrupted night.',
    synopsis: 'One continuous observatory scene resolves a supernatural warning without a location change.',
    screenplayText: GOLDEN_SCREENPLAY,
    estimatedDurationSeconds: 240,
    source: { kind: 'generated', label: 'Golden Journey request' },
    assumptions: ['The requested 240 seconds remain one continuous dramatic context.'],
    openQuestions: [],
  }
}

function buildGoldenAssetManifest(): unknown {
  return {
    kind: 'asset_manifest',
    overview: 'Reusable visual assets grounded directly in the supplied observatory screenplay.',
    assets: [
      {
        kind: 'character',
        canonicalName: 'Mara',
        aliases: [],
        sourceRefs: [{
          sourceExcerpt: 'Mara crosses the silent circular room',
          reason: 'Mara performs the visible action throughout the screenplay and needs a stable visual identity.',
        }],
        stableDescription: 'A solitary adult astronomer with a practical field coat and an observant, composed bearing.',
        generationPrompt: 'Restrained monochrome ink-wash character reference of Mara, a solitary adult astronomer in a practical field coat, with one controlled red accent and clear full-body identity.',
        negativePrompt: null,
        referenceRequirements: [],
        continuityRequirements: ['Preserve Mara’s coat, age, and facial identity across every generated image.'],
      },
      {
        kind: 'location',
        canonicalName: 'Observatory at Night',
        aliases: ['Observatory'],
        sourceRefs: [{
          sourceExcerpt: 'INT. OBSERVATORY - NIGHT',
          reason: 'The complete visible story takes place in this reusable production location.',
        }],
        stableDescription: 'A circular observatory interior with a central brass telescope, surrounding windows, and a closable dome.',
        generationPrompt: 'Restrained monochrome ink-wash environment reference of a circular observatory interior at night, central brass telescope, surrounding storm windows, closable dome, cold moonlight, and one controlled red accent.',
        negativePrompt: null,
        referenceRequirements: [],
        continuityRequirements: ['Preserve the circular floor plan, central telescope position, windows, and dome structure.'],
      },
      {
        kind: 'prop',
        canonicalName: 'Central Telescope',
        aliases: ['Telescope'],
        sourceRefs: [{
          sourceExcerpt: 'The telescope rotates by itself',
          reason: 'The telescope drives multiple visible actions and must retain a stable construction.',
        }],
        stableDescription: 'A large brass astronomical telescope on a fixed central rotating mount.',
        generationPrompt: 'Restrained monochrome ink-wash prop reference of a large brass astronomical telescope on a fixed rotating mount, precise mechanical construction, and one controlled red accent.',
        negativePrompt: null,
        referenceRequirements: [],
        continuityRequirements: ['Preserve the brass construction, lens proportions, and rotating base.'],
      },
    ],
    assumptions: [],
    warnings: [],
  }
}

function buildGoldenStyleBible(): unknown {
  return {
    kind: 'creative_direction',
    design: {
      mode: 'final',
      creativeDirection: {
        rawUserStyle: 'restrained ink-wash science fiction',
        styleSummary: 'Restrained monochrome ink-wash science fiction with one red accent.',
        visual: {
          visualStyle: 'Fine ink contours, soft paper grain, measured negative space, and restrained motion.',
          assetImageStyle: {
            lighting: 'Low-key moonlight with a single controlled red practical accent.',
            texture: 'Visible cold-press paper grain and dry-brush shadow edges.',
          },
        },
        narrative: 'Reveal the anomaly through restrained observation and delayed confirmation.',
        directing: 'Locked frames dominate; motivated movement begins only after the anomaly becomes undeniable.',
        editing: 'Use evidence-driven hard cuts and no decorative glitch transitions.',
        sound: 'Preserve observatory room tone, sparse mechanical detail, and silence at the warning reveal.',
        assetPolicy: 'Keep human and observatory identities naturalistic while the red warning motif remains the only graphic accent.',
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

function buildGoldenStoryCanon(schema: unknown): unknown {
  const output = generateGoldenStructuredValue(schema)
  const outputRecord = asRecord(output)
  const bundle = asRecord(outputRecord?.bundle)
  if (!bundle) return output

  const sourceAnchor = {
    startBlockId: 'p0001',
    startQuote: 'INT. OBSERVATORY - NIGHT',
    endBlockId: 'p0001',
    endQuote: 'Mara crosses the silent circular room',
  }
  const beatSheet = asRecord(bundle.beatSheet)
  if (Array.isArray(beatSheet?.beats)) {
    for (const beat of beatSheet.beats) {
      const beatRecord = asRecord(beat)
      if (beatRecord) beatRecord.sourceAnchor = sourceAnchor
    }
  }
  const emotionalCurve = asRecord(bundle.emotionalCurve)
  if (Array.isArray(emotionalCurve?.cues)) {
    for (const cue of emotionalCurve.cues) {
      const cueRecord = asRecord(cue)
      if (cueRecord) cueRecord.sourceAnchor = sourceAnchor
    }
  }
  return output
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
  if (schemaContainsLiteral(schema, 'screenplay')) return JSON.stringify(buildGoldenScreenplay())
  if (schemaContainsLiteral(schema, 'story_canon')) return JSON.stringify(buildGoldenStoryCanon(schema))
  if (schemaContainsLiteral(schema, 'creative_direction')) return JSON.stringify(buildGoldenStyleBible())
  if (schemaContainsLiteral(schema, 'asset_manifest')) return JSON.stringify(buildGoldenAssetManifest())
  if (schemaContainsLiteral(schema, 'chapter_plan')) return JSON.stringify(buildGoldenChapterPlan())
  return JSON.stringify(generateGoldenStructuredValue(schema))
}
