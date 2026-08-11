import type {
  WorkspaceResourceJsonObject,
  WorkspaceResourceJsonValue,
  WorkspaceResourceKind,
  WorkspaceResourceMediaType,
} from './contracts'

export const WORKSPACE_RESOURCE_SCHEMA = {
  FOLDER: 'system.folder',
  GENERIC_TEXT: 'generic.text',
  GENERIC_IMAGE: 'generic.image',
  GENERIC_VIDEO: 'generic.video',
  SCREENPLAY: 'project.screenplay',
  // Historical read-only identity: the long_form domain was removed and
  // continuity now flows through delivered screenplays and batch exit states.
  // Existing Resources remain readable without a destructive data migration.
  LONG_FORM_PLAN: 'project.long_form_plan',
  CREATIVE_DIRECTION: 'project.creative_direction',
  // Stable persisted schema IDs; names now describe optional saved documents,
  // never a production submission protocol.
  ASSET_GENERATION_BATCH: 'project.asset_manifest',
  VIDEO_GENERATION_BATCH: 'project.video_prompt_set',
  AUDIO_GENERATION_BATCH: 'project.music_direction',
  // Historical read-only identity. New generation cannot mint this retired
  // schema; existing Resources remain readable without a destructive data migration.
  LEGACY_STYLE: 'project.style',
  CHARACTER_IMAGE: 'project.character_image',
  LOCATION_IMAGE: 'project.location_image',
  PROP_IMAGE: 'project.prop_image',
  VIDEO_SEGMENT: 'project.video_segment',
  COMPOSITE_VIDEO: 'project.composite_video',
  BGM_AUDIO: 'project.bgm_audio',
  SOUND_EFFECT_AUDIO: 'project.sound_effect_audio',
  VOICE_REFERENCE: 'project.voice_reference',
  RENDERED_VIDEO: 'project.rendered_video',
  WEB_REFERENCE_IMAGE: 'project.web_reference_image',
  UPLOAD_IMAGE: 'project.upload_image',
  UPLOAD_AUDIO: 'project.upload_audio',
} as const

export type WorkspaceResourceSchemaId = typeof WORKSPACE_RESOURCE_SCHEMA[keyof typeof WORKSPACE_RESOURCE_SCHEMA]

export const WORKSPACE_RESOURCE_FOLDER_SCHEMA_ID = WORKSPACE_RESOURCE_SCHEMA.FOLDER

export type WorkspaceResourceStructuredSummaryProjector = (
  data: WorkspaceResourceJsonValue,
) => string | null

function objectValue(value: WorkspaceResourceJsonValue): WorkspaceResourceJsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function stringValue(
  object: WorkspaceResourceJsonObject | null,
  key: string,
): string | null {
  const value = object?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function arrayField(
  object: WorkspaceResourceJsonObject | null,
  key: string,
): readonly WorkspaceResourceJsonValue[] {
  const value = object?.[key]
  return Array.isArray(value) ? value : []
}

function firstText(...values: readonly (string | null)[]): string | null {
  return values.find((value): value is string => value !== null) ?? null
}

const STRUCTURED_SUMMARY_PROJECTORS: Partial<
  Record<WorkspaceResourceSchemaId, WorkspaceResourceStructuredSummaryProjector>
> = {
  [WORKSPACE_RESOURCE_SCHEMA.SCREENPLAY]: (data) => {
    const object = objectValue(data)
    return firstText(
      stringValue(object, 'logline'),
      stringValue(object, 'synopsis'),
      stringValue(object, 'screenplayText'),
    )
  },
  [WORKSPACE_RESOURCE_SCHEMA.CREATIVE_DIRECTION]: (data) => (
    stringValue(objectValue(data), 'styleSummary')
  ),
  [WORKSPACE_RESOURCE_SCHEMA.LONG_FORM_PLAN]: (data) => (
    stringValue(objectValue(data), 'overview')
  ),
  [WORKSPACE_RESOURCE_SCHEMA.ASSET_GENERATION_BATCH]: (data) => (
    stringValue(objectValue(data), 'overview')
  ),
  [WORKSPACE_RESOURCE_SCHEMA.VIDEO_GENERATION_BATCH]: (data) => {
    const firstSegment = objectValue(arrayField(objectValue(data), 'items')[0] ?? null)
    return firstText(
      stringValue(firstSegment, 'prompt'),
      stringValue(firstSegment, 'key'),
    )
  },
  [WORKSPACE_RESOURCE_SCHEMA.AUDIO_GENERATION_BATCH]: (data) => (
    stringValue(objectValue(data), 'overview')
  ),
}

/**
 * The exhaustive public vocabulary for Resource semantics, grouped by the
 * media capability that can create it. Agent tool schemas and runtime
 * validation consume these exact tuples; callers must never maintain a second
 * schema-id list or accept arbitrary strings.
 */
export const WORKSPACE_RESOURCE_SCHEMA_IDS_BY_MEDIA = {
  text: [
    WORKSPACE_RESOURCE_SCHEMA.GENERIC_TEXT,
    WORKSPACE_RESOURCE_SCHEMA.SCREENPLAY,
    WORKSPACE_RESOURCE_SCHEMA.LONG_FORM_PLAN,
    WORKSPACE_RESOURCE_SCHEMA.CREATIVE_DIRECTION,
    WORKSPACE_RESOURCE_SCHEMA.ASSET_GENERATION_BATCH,
    WORKSPACE_RESOURCE_SCHEMA.VIDEO_GENERATION_BATCH,
    WORKSPACE_RESOURCE_SCHEMA.AUDIO_GENERATION_BATCH,
  ],
  image: [
    WORKSPACE_RESOURCE_SCHEMA.GENERIC_IMAGE,
    WORKSPACE_RESOURCE_SCHEMA.LEGACY_STYLE,
    WORKSPACE_RESOURCE_SCHEMA.CHARACTER_IMAGE,
    WORKSPACE_RESOURCE_SCHEMA.LOCATION_IMAGE,
    WORKSPACE_RESOURCE_SCHEMA.PROP_IMAGE,
    WORKSPACE_RESOURCE_SCHEMA.WEB_REFERENCE_IMAGE,
    WORKSPACE_RESOURCE_SCHEMA.UPLOAD_IMAGE,
  ],
  audio: [
    WORKSPACE_RESOURCE_SCHEMA.BGM_AUDIO,
    WORKSPACE_RESOURCE_SCHEMA.SOUND_EFFECT_AUDIO,
    WORKSPACE_RESOURCE_SCHEMA.VOICE_REFERENCE,
    WORKSPACE_RESOURCE_SCHEMA.UPLOAD_AUDIO,
  ],
  video: [
    WORKSPACE_RESOURCE_SCHEMA.GENERIC_VIDEO,
    WORKSPACE_RESOURCE_SCHEMA.VIDEO_SEGMENT,
    WORKSPACE_RESOURCE_SCHEMA.COMPOSITE_VIDEO,
    WORKSPACE_RESOURCE_SCHEMA.RENDERED_VIDEO,
  ],
} as const satisfies Record<WorkspaceResourceMediaType, readonly WorkspaceResourceSchemaId[]>

/**
 * Schemas whose Resources may only originate from a dedicated import entry
 * (web search import, user upload). The generic create_* generation
 * operations must never mint these identities: a generated Resource claiming
 * an import schema would fabricate external-material provenance that never
 * crossed the import boundary.
 */
const IMPORT_ORIGIN_SCHEMA_IDS: ReadonlySet<WorkspaceResourceSchemaId> = new Set([
  WORKSPACE_RESOURCE_SCHEMA.WEB_REFERENCE_IMAGE,
  WORKSPACE_RESOURCE_SCHEMA.UPLOAD_IMAGE,
  WORKSPACE_RESOURCE_SCHEMA.UPLOAD_AUDIO,
])

/**
 * Schemas minted only by their own dedicated operation. The generic create_*
 * generation operations must never offer or mint these identities: a
 * music-model output labeled as a voice reference would bypass the single
 * `generate_voice` entry (AP-08).
 */
const DEDICATED_ORIGIN_SCHEMA_IDS: ReadonlySet<WorkspaceResourceSchemaId> = new Set([
  WORKSPACE_RESOURCE_SCHEMA.VOICE_REFERENCE,
])

const RETIRED_SCHEMA_IDS: ReadonlySet<WorkspaceResourceSchemaId> = new Set([
  WORKSPACE_RESOURCE_SCHEMA.LEGACY_STYLE,
  WORKSPACE_RESOURCE_SCHEMA.LONG_FORM_PLAN,
])

/**
 * Formal creative JSON identities are minted only by the explicit
 * save_project_document operation after the outputKind registry validates the
 * entire inline value. Generic schemas cannot label arbitrary JSON as a
 * screenplay, direction, or generation batch.
 */
const CREATIVE_OUTPUT_SCHEMA_IDS: ReadonlySet<WorkspaceResourceSchemaId> = new Set([
  WORKSPACE_RESOURCE_SCHEMA.SCREENPLAY,
  WORKSPACE_RESOURCE_SCHEMA.CREATIVE_DIRECTION,
  WORKSPACE_RESOURCE_SCHEMA.ASSET_GENERATION_BATCH,
  WORKSPACE_RESOURCE_SCHEMA.VIDEO_GENERATION_BATCH,
  WORKSPACE_RESOURCE_SCHEMA.AUDIO_GENERATION_BATCH,
])

function generationMintableSchemas(
  schemaIds: readonly WorkspaceResourceSchemaId[],
): readonly WorkspaceResourceSchemaId[] {
  return schemaIds.filter((schemaId) => (
    !IMPORT_ORIGIN_SCHEMA_IDS.has(schemaId)
    && !DEDICATED_ORIGIN_SCHEMA_IDS.has(schemaId)
    && !CREATIVE_OUTPUT_SCHEMA_IDS.has(schemaId)
    && !RETIRED_SCHEMA_IDS.has(schemaId)
  ))
}

/**
 * The subset of the public vocabulary that the generic generation operations
 * may mint. Derived from the same exhaustive registry so tool schemas and
 * conformance evidence share one authority.
 */
export const WORKSPACE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA = {
  text: generationMintableSchemas(WORKSPACE_RESOURCE_SCHEMA_IDS_BY_MEDIA.text),
  image: generationMintableSchemas(WORKSPACE_RESOURCE_SCHEMA_IDS_BY_MEDIA.image),
  audio: generationMintableSchemas(WORKSPACE_RESOURCE_SCHEMA_IDS_BY_MEDIA.audio),
  video: generationMintableSchemas(WORKSPACE_RESOURCE_SCHEMA_IDS_BY_MEDIA.video),
} satisfies Record<WorkspaceResourceMediaType, readonly WorkspaceResourceSchemaId[]>

export function isImportOriginWorkspaceResourceSchema(schemaId: string): boolean {
  return IMPORT_ORIGIN_SCHEMA_IDS.has(schemaId as WorkspaceResourceSchemaId)
}

export interface WorkspaceResourceSchemaDefinition {
  readonly schemaId: WorkspaceResourceSchemaId
  readonly resourceKind: WorkspaceResourceKind
  readonly mediaType: WorkspaceResourceMediaType | null
  readonly structuredSummaryProjector?: WorkspaceResourceStructuredSummaryProjector
}

function schemaDefinitions(
  mediaType: WorkspaceResourceMediaType,
  schemaIds: readonly WorkspaceResourceSchemaId[],
): WorkspaceResourceSchemaDefinition[] {
  return schemaIds.map((schemaId) => ({
    schemaId,
    resourceKind: 'file',
    mediaType,
    structuredSummaryProjector: STRUCTURED_SUMMARY_PROJECTORS[schemaId],
  }))
}

export const WORKSPACE_RESOURCE_SCHEMAS: readonly WorkspaceResourceSchemaDefinition[] = [
  {
    schemaId: WORKSPACE_RESOURCE_SCHEMA.FOLDER,
    resourceKind: 'folder',
    mediaType: null,
  },
  ...schemaDefinitions('text', WORKSPACE_RESOURCE_SCHEMA_IDS_BY_MEDIA.text),
  ...schemaDefinitions('image', WORKSPACE_RESOURCE_SCHEMA_IDS_BY_MEDIA.image),
  ...schemaDefinitions('audio', WORKSPACE_RESOURCE_SCHEMA_IDS_BY_MEDIA.audio),
  ...schemaDefinitions('video', WORKSPACE_RESOURCE_SCHEMA_IDS_BY_MEDIA.video),
]

const SCHEMA_BY_ID = new Map(WORKSPACE_RESOURCE_SCHEMAS.map((definition) => [definition.schemaId, definition]))

export function getWorkspaceResourceSchema(schemaId: string): WorkspaceResourceSchemaDefinition | null {
  return SCHEMA_BY_ID.get(schemaId as WorkspaceResourceSchemaId) ?? null
}

export function requireWorkspaceResourceSchema(schemaId: string): WorkspaceResourceSchemaDefinition {
  const definition = getWorkspaceResourceSchema(schemaId.trim())
  if (!definition) throw new Error(`WORKSPACE_RESOURCE_SCHEMA_UNKNOWN:${schemaId}`)
  return definition
}
