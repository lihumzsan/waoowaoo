export const CREATIVE_SKILL_IDS = [
  'creative-core',
  'story-development',
  'continuity-memory',
  'director-core',
  'creative-direction',
  'asset-development',
  'video-direction',
  'music-direction',
  'quality-review',
] as const

export type CreativeSkillId = (typeof CREATIVE_SKILL_IDS)[number]

export type CreativeSkillUri = `skill://${CreativeSkillId}/SKILL.md`

export interface CreativeSkillDefinition {
  readonly id: CreativeSkillId
  readonly version: string
  readonly title: string
  readonly summary: string
  readonly tags: readonly string[]
  readonly entryUri: CreativeSkillUri
}

export interface CreativeSkillDiscovery {
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
