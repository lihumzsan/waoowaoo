export const CREATIVE_SKILL_IDS = [
  'creative-core',
  'story-development',
  'commercial-brief',
  'commercial-script',
  'creative-direction',
  'asset-development',
  'video-direction',
  'music-direction',
] as const

export type CreativeSkillId = (typeof CREATIVE_SKILL_IDS)[number]

export const CREATIVE_DOMAIN_KINDS = [
  'story',
  'commercial_brief',
  'commercial_script',
  'direction',
  'assets',
  'video',
  'music',
] as const

export type CreativeDomainKind = (typeof CREATIVE_DOMAIN_KINDS)[number]

export const CREATIVE_OUTPUT_KINDS = [
  'screenplay',
  'commercial_brief',
  'commercial_script',
  'creative_direction',
  'asset_generation_batch',
  'video_generation_batch',
  'audio_generation_batch',
] as const

export type CreativeOutputKind = (typeof CREATIVE_OUTPUT_KINDS)[number]

export const CREATIVE_PRODUCTION_OUTPUT_KINDS = [
  'asset_generation_batch',
  'video_generation_batch',
  'audio_generation_batch',
] as const satisfies readonly CreativeOutputKind[]

export type CreativeProductionOutputKind = (typeof CREATIVE_PRODUCTION_OUTPUT_KINDS)[number]

export type CreativeSkillUri = `skill://${CreativeSkillId}/SKILL.md`

export interface CreativeSkillDefinition {
  readonly id: CreativeSkillId
  readonly version: string
  readonly title: string
  readonly summary: string
  readonly tags: readonly string[]
  readonly entryUri: CreativeSkillUri
}

export interface ReadCreativeSkillResourceInput {
  readonly uri: string
}

export interface CreativeSkillResource {
  readonly skillId: CreativeSkillId
  readonly version: string
  readonly uri: CreativeSkillUri
  readonly checksum: string
  readonly content: string
}
