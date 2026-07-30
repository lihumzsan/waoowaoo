import type {
  CreativeResourceJsonObject,
  CreativeResourceJsonValue,
  CreativeResourceMediaType,
} from './contracts'

export const CREATIVE_RESOURCE_SCHEMA = {
  GENERIC_TEXT: 'generic.text',
  GENERIC_IMAGE: 'generic.image',
  GENERIC_VIDEO: 'generic.video',
  SCREENPLAY: 'project.screenplay',
  CHAPTER_CONTINUITY_PLAN: 'project.chapter_continuity_plan',
  CREATIVE_DIRECTION: 'project.creative_direction',
  ASSET_MANIFEST: 'project.asset_manifest',
  VIDEO_PROMPT_SET: 'project.video_prompt_set',
  MUSIC_DIRECTION: 'project.music_direction',
  STYLE: 'project.style',
  CHARACTER_IMAGE: 'project.character_image',
  LOCATION_IMAGE: 'project.location_image',
  PROP_IMAGE: 'project.prop_image',
  VIDEO_SEGMENT: 'project.video_segment',
  CHAPTER_VIDEO: 'project.chapter_video',
  BGM_AUDIO: 'project.bgm_audio',
  VOICE_REFERENCE: 'project.voice_reference',
  RENDERED_VIDEO: 'project.rendered_video',
  WEB_REFERENCE_IMAGE: 'project.web_reference_image',
  UPLOAD_IMAGE: 'project.upload_image',
  UPLOAD_AUDIO: 'project.upload_audio',
} as const

export type CreativeResourceSchemaId = typeof CREATIVE_RESOURCE_SCHEMA[keyof typeof CREATIVE_RESOURCE_SCHEMA]

export type CreativeResourceStructuredSummaryProjector = (
  data: CreativeResourceJsonValue,
) => string | null

function objectValue(value: CreativeResourceJsonValue): CreativeResourceJsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function stringValue(
  object: CreativeResourceJsonObject | null,
  key: string,
): string | null {
  const value = object?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function objectField(
  object: CreativeResourceJsonObject | null,
  key: string,
): CreativeResourceJsonObject | null {
  const value = object?.[key]
  return value === undefined ? null : objectValue(value)
}

function arrayField(
  object: CreativeResourceJsonObject | null,
  key: string,
): readonly CreativeResourceJsonValue[] {
  const value = object?.[key]
  return Array.isArray(value) ? value : []
}

function firstText(...values: readonly (string | null)[]): string | null {
  return values.find((value): value is string => value !== null) ?? null
}

const STRUCTURED_SUMMARY_PROJECTORS: Partial<
  Record<CreativeResourceSchemaId, CreativeResourceStructuredSummaryProjector>
> = {
  [CREATIVE_RESOURCE_SCHEMA.SCREENPLAY]: (data) => {
    const object = objectValue(data)
    return firstText(
      stringValue(object, 'logline'),
      stringValue(object, 'synopsis'),
      stringValue(object, 'screenplayText'),
    )
  },
  [CREATIVE_RESOURCE_SCHEMA.CHAPTER_CONTINUITY_PLAN]: (data) => {
    const plan = objectValue(data)
    const storyCanonBundle = objectField(plan, 'storyCanon')
    const storyCanon = objectField(storyCanonBundle, 'storyCanon')
    const firstChapter = objectValue(arrayField(plan, 'chapters')[0] ?? null)
    return firstText(
      stringValue(storyCanon, 'logline'),
      stringValue(storyCanon, 'synopsis'),
      stringValue(storyCanon, 'title'),
      stringValue(plan, 'rationale'),
      stringValue(firstChapter, 'summary'),
      stringValue(firstChapter, 'title'),
    )
  },
  [CREATIVE_RESOURCE_SCHEMA.CREATIVE_DIRECTION]: (data) => (
    stringValue(objectValue(data), 'styleSummary')
  ),
  [CREATIVE_RESOURCE_SCHEMA.ASSET_MANIFEST]: (data) => (
    stringValue(objectValue(data), 'overview')
  ),
  [CREATIVE_RESOURCE_SCHEMA.VIDEO_PROMPT_SET]: (data) => {
    const firstSegment = objectValue(arrayField(objectValue(data), 'segments')[0] ?? null)
    return firstText(
      stringValue(firstSegment, 'prompt'),
      stringValue(firstSegment, 'key'),
    )
  },
  [CREATIVE_RESOURCE_SCHEMA.MUSIC_DIRECTION]: (data) => (
    stringValue(objectValue(data), 'overview')
  ),
}

/**
 * The exhaustive public vocabulary for Resource semantics, grouped by the
 * media capability that can create it. Agent tool schemas and runtime
 * validation consume these exact tuples; callers must never maintain a second
 * schema-id list or accept arbitrary strings.
 */
export const CREATIVE_RESOURCE_SCHEMA_IDS_BY_MEDIA = {
  text: [
    CREATIVE_RESOURCE_SCHEMA.GENERIC_TEXT,
    CREATIVE_RESOURCE_SCHEMA.SCREENPLAY,
    CREATIVE_RESOURCE_SCHEMA.CHAPTER_CONTINUITY_PLAN,
    CREATIVE_RESOURCE_SCHEMA.CREATIVE_DIRECTION,
    CREATIVE_RESOURCE_SCHEMA.ASSET_MANIFEST,
    CREATIVE_RESOURCE_SCHEMA.VIDEO_PROMPT_SET,
    CREATIVE_RESOURCE_SCHEMA.MUSIC_DIRECTION,
  ],
  image: [
    CREATIVE_RESOURCE_SCHEMA.GENERIC_IMAGE,
    CREATIVE_RESOURCE_SCHEMA.STYLE,
    CREATIVE_RESOURCE_SCHEMA.CHARACTER_IMAGE,
    CREATIVE_RESOURCE_SCHEMA.LOCATION_IMAGE,
    CREATIVE_RESOURCE_SCHEMA.PROP_IMAGE,
    CREATIVE_RESOURCE_SCHEMA.WEB_REFERENCE_IMAGE,
    CREATIVE_RESOURCE_SCHEMA.UPLOAD_IMAGE,
  ],
  audio: [
    CREATIVE_RESOURCE_SCHEMA.BGM_AUDIO,
    CREATIVE_RESOURCE_SCHEMA.VOICE_REFERENCE,
    CREATIVE_RESOURCE_SCHEMA.UPLOAD_AUDIO,
  ],
  video: [
    CREATIVE_RESOURCE_SCHEMA.GENERIC_VIDEO,
    CREATIVE_RESOURCE_SCHEMA.VIDEO_SEGMENT,
    CREATIVE_RESOURCE_SCHEMA.CHAPTER_VIDEO,
    CREATIVE_RESOURCE_SCHEMA.RENDERED_VIDEO,
  ],
} as const satisfies Record<CreativeResourceMediaType, readonly CreativeResourceSchemaId[]>

/**
 * Schemas whose Resources may only originate from a dedicated import entry
 * (web search import, user upload). The generic create_* generation
 * operations must never mint these identities: a generated Resource claiming
 * an import schema would fabricate external-material provenance that never
 * crossed the import boundary.
 */
const IMPORT_ORIGIN_SCHEMA_IDS: ReadonlySet<CreativeResourceSchemaId> = new Set([
  CREATIVE_RESOURCE_SCHEMA.WEB_REFERENCE_IMAGE,
  CREATIVE_RESOURCE_SCHEMA.UPLOAD_IMAGE,
  CREATIVE_RESOURCE_SCHEMA.UPLOAD_AUDIO,
])

/**
 * Schemas minted only by their own dedicated operation. The generic create_*
 * generation operations must never offer or mint these identities: a
 * music-model output labeled as a voice reference would bypass the single
 * `generate_voice` entry (AP-08).
 */
const DEDICATED_ORIGIN_SCHEMA_IDS: ReadonlySet<CreativeResourceSchemaId> = new Set([
  CREATIVE_RESOURCE_SCHEMA.VOICE_REFERENCE,
])

function generationMintableSchemas(
  schemaIds: readonly CreativeResourceSchemaId[],
): readonly CreativeResourceSchemaId[] {
  return schemaIds.filter((schemaId) => (
    !IMPORT_ORIGIN_SCHEMA_IDS.has(schemaId) && !DEDICATED_ORIGIN_SCHEMA_IDS.has(schemaId)
  ))
}

/**
 * The subset of the public vocabulary that the generic generation operations
 * may mint. Derived from the same exhaustive registry so tool schemas and
 * conformance evidence share one authority.
 */
export const CREATIVE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA = {
  text: generationMintableSchemas(CREATIVE_RESOURCE_SCHEMA_IDS_BY_MEDIA.text),
  image: generationMintableSchemas(CREATIVE_RESOURCE_SCHEMA_IDS_BY_MEDIA.image),
  audio: generationMintableSchemas(CREATIVE_RESOURCE_SCHEMA_IDS_BY_MEDIA.audio),
  video: generationMintableSchemas(CREATIVE_RESOURCE_SCHEMA_IDS_BY_MEDIA.video),
} satisfies Record<CreativeResourceMediaType, readonly CreativeResourceSchemaId[]>

export function isImportOriginCreativeResourceSchema(schemaId: string): boolean {
  return IMPORT_ORIGIN_SCHEMA_IDS.has(schemaId as CreativeResourceSchemaId)
}

export interface CreativeResourceSchemaDefinition {
  readonly schemaId: CreativeResourceSchemaId
  readonly mediaType: CreativeResourceMediaType
  readonly structuredSummaryProjector?: CreativeResourceStructuredSummaryProjector
}

function schemaDefinitions(
  mediaType: CreativeResourceMediaType,
  schemaIds: readonly CreativeResourceSchemaId[],
): CreativeResourceSchemaDefinition[] {
  return schemaIds.map((schemaId) => ({
    schemaId,
    mediaType,
    structuredSummaryProjector: STRUCTURED_SUMMARY_PROJECTORS[schemaId],
  }))
}

export const CREATIVE_RESOURCE_SCHEMAS: readonly CreativeResourceSchemaDefinition[] = [
  ...schemaDefinitions('text', CREATIVE_RESOURCE_SCHEMA_IDS_BY_MEDIA.text),
  ...schemaDefinitions('image', CREATIVE_RESOURCE_SCHEMA_IDS_BY_MEDIA.image),
  ...schemaDefinitions('audio', CREATIVE_RESOURCE_SCHEMA_IDS_BY_MEDIA.audio),
  ...schemaDefinitions('video', CREATIVE_RESOURCE_SCHEMA_IDS_BY_MEDIA.video),
]

const SCHEMA_BY_ID = new Map(CREATIVE_RESOURCE_SCHEMAS.map((definition) => [definition.schemaId, definition]))

export function getCreativeResourceSchema(schemaId: string): CreativeResourceSchemaDefinition | null {
  return SCHEMA_BY_ID.get(schemaId as CreativeResourceSchemaId) ?? null
}

export function requireCreativeResourceSchema(schemaId: string): CreativeResourceSchemaDefinition {
  const definition = getCreativeResourceSchema(schemaId.trim())
  if (!definition) throw new Error(`CREATIVE_RESOURCE_SCHEMA_UNKNOWN:${schemaId}`)
  return definition
}
