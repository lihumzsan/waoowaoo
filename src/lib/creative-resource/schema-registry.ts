import type { CreativeResourceMediaType } from './contracts'

export const CREATIVE_RESOURCE_SCHEMA = {
  GENERIC_TEXT: 'generic.text',
  GENERIC_IMAGE: 'generic.image',
  GENERIC_AUDIO: 'generic.audio',
  GENERIC_VIDEO: 'generic.video',
  SOURCE_SCRIPT: 'project.source_script',
  EDIT_BIBLE: 'project.edit_bible',
  STYLE_BIBLE: 'project.style_bible',
  STYLE: 'project.style',
  EDIT_SCRIPT: 'project.edit_script',
  SHOT_EXECUTION_PLAN: 'project.shot_execution_plan',
  CHARACTER_IMAGE: 'project.character_image',
  LOCATION_IMAGE: 'project.location_image',
  PROP_IMAGE: 'project.prop_image',
  VIDEO_SEGMENT: 'project.video_segment',
  CHAPTER_VIDEO: 'project.chapter_video',
  BGM_DESIGN: 'project.bgm_design',
  BGM_AUDIO: 'project.bgm_audio',
  RENDERED_VIDEO: 'project.rendered_video',
} as const

export type CreativeResourceSchemaId = typeof CREATIVE_RESOURCE_SCHEMA[keyof typeof CREATIVE_RESOURCE_SCHEMA]

/**
 * The exhaustive public vocabulary for Resource semantics, grouped by the
 * media capability that can create it. Agent tool schemas and runtime
 * validation consume these exact tuples; callers must never maintain a second
 * schema-id list or accept arbitrary strings.
 */
export const CREATIVE_RESOURCE_SCHEMA_IDS_BY_MEDIA = {
  text: [
    CREATIVE_RESOURCE_SCHEMA.GENERIC_TEXT,
    CREATIVE_RESOURCE_SCHEMA.SOURCE_SCRIPT,
    CREATIVE_RESOURCE_SCHEMA.EDIT_BIBLE,
    CREATIVE_RESOURCE_SCHEMA.STYLE_BIBLE,
    CREATIVE_RESOURCE_SCHEMA.EDIT_SCRIPT,
    CREATIVE_RESOURCE_SCHEMA.SHOT_EXECUTION_PLAN,
    CREATIVE_RESOURCE_SCHEMA.BGM_DESIGN,
  ],
  image: [
    CREATIVE_RESOURCE_SCHEMA.GENERIC_IMAGE,
    CREATIVE_RESOURCE_SCHEMA.STYLE,
    CREATIVE_RESOURCE_SCHEMA.CHARACTER_IMAGE,
    CREATIVE_RESOURCE_SCHEMA.LOCATION_IMAGE,
    CREATIVE_RESOURCE_SCHEMA.PROP_IMAGE,
  ],
  audio: [
    CREATIVE_RESOURCE_SCHEMA.GENERIC_AUDIO,
    CREATIVE_RESOURCE_SCHEMA.BGM_AUDIO,
  ],
  video: [
    CREATIVE_RESOURCE_SCHEMA.GENERIC_VIDEO,
    CREATIVE_RESOURCE_SCHEMA.VIDEO_SEGMENT,
    CREATIVE_RESOURCE_SCHEMA.CHAPTER_VIDEO,
    CREATIVE_RESOURCE_SCHEMA.RENDERED_VIDEO,
  ],
} as const satisfies Record<CreativeResourceMediaType, readonly CreativeResourceSchemaId[]>

export interface CreativeResourceSchemaDefinition {
  readonly schemaId: CreativeResourceSchemaId
  readonly mediaType: CreativeResourceMediaType
}

function schemaDefinitions(
  mediaType: CreativeResourceMediaType,
  schemaIds: readonly CreativeResourceSchemaId[],
): CreativeResourceSchemaDefinition[] {
  return schemaIds.map((schemaId) => ({ schemaId, mediaType }))
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
