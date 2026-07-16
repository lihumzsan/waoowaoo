import type { CreativeResourceMediaType } from './contracts'

export const CREATIVE_RESOURCE_SCHEMA = {
  GENERIC_TEXT: 'generic.text',
  GENERIC_IMAGE: 'generic.image',
  GENERIC_AUDIO: 'generic.audio',
  GENERIC_VIDEO: 'generic.video',
  SOURCE_SCRIPT: 'project.source_script',
  EDIT_BIBLE: 'project.edit_bible',
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

export interface CreativeResourceSchemaDefinition {
  readonly schemaId: CreativeResourceSchemaId
  readonly mediaType: CreativeResourceMediaType
}

export const CREATIVE_RESOURCE_SCHEMAS = [
  { schemaId: CREATIVE_RESOURCE_SCHEMA.GENERIC_TEXT, mediaType: 'text' },
  { schemaId: CREATIVE_RESOURCE_SCHEMA.GENERIC_IMAGE, mediaType: 'image' },
  { schemaId: CREATIVE_RESOURCE_SCHEMA.GENERIC_AUDIO, mediaType: 'audio' },
  { schemaId: CREATIVE_RESOURCE_SCHEMA.GENERIC_VIDEO, mediaType: 'video' },
  { schemaId: CREATIVE_RESOURCE_SCHEMA.SOURCE_SCRIPT, mediaType: 'text' },
  { schemaId: CREATIVE_RESOURCE_SCHEMA.EDIT_BIBLE, mediaType: 'text' },
  { schemaId: CREATIVE_RESOURCE_SCHEMA.STYLE, mediaType: 'image' },
  { schemaId: CREATIVE_RESOURCE_SCHEMA.EDIT_SCRIPT, mediaType: 'text' },
  { schemaId: CREATIVE_RESOURCE_SCHEMA.SHOT_EXECUTION_PLAN, mediaType: 'text' },
  { schemaId: CREATIVE_RESOURCE_SCHEMA.CHARACTER_IMAGE, mediaType: 'image' },
  { schemaId: CREATIVE_RESOURCE_SCHEMA.LOCATION_IMAGE, mediaType: 'image' },
  { schemaId: CREATIVE_RESOURCE_SCHEMA.PROP_IMAGE, mediaType: 'image' },
  { schemaId: CREATIVE_RESOURCE_SCHEMA.VIDEO_SEGMENT, mediaType: 'video' },
  { schemaId: CREATIVE_RESOURCE_SCHEMA.CHAPTER_VIDEO, mediaType: 'video' },
  { schemaId: CREATIVE_RESOURCE_SCHEMA.BGM_DESIGN, mediaType: 'text' },
  { schemaId: CREATIVE_RESOURCE_SCHEMA.BGM_AUDIO, mediaType: 'audio' },
  { schemaId: CREATIVE_RESOURCE_SCHEMA.RENDERED_VIDEO, mediaType: 'video' },
] as const satisfies readonly CreativeResourceSchemaDefinition[]

const SCHEMA_BY_ID = new Map(CREATIVE_RESOURCE_SCHEMAS.map((definition) => [definition.schemaId, definition]))

export function getCreativeResourceSchema(schemaId: string): CreativeResourceSchemaDefinition | null {
  return SCHEMA_BY_ID.get(schemaId as CreativeResourceSchemaId) ?? null
}

export function requireCreativeResourceSchema(schemaId: string): CreativeResourceSchemaDefinition {
  const definition = getCreativeResourceSchema(schemaId.trim())
  if (!definition) throw new Error(`CREATIVE_RESOURCE_SCHEMA_UNKNOWN:${schemaId}`)
  return definition
}
