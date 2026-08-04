export const CREATIVE_SKILL_IDS = [
  'creative-core',
  'story-development',
  'long-form-production',
  'creative-direction',
  'asset-development',
  'video-direction',
  'music-direction',
] as const

export type CreativeSkillId = (typeof CREATIVE_SKILL_IDS)[number]

export const CREATIVE_WORKER_KINDS = [
  'story',
  'long_form',
  'direction',
  'assets',
  'video',
  'music',
] as const

export type CreativeWorkerKind = (typeof CREATIVE_WORKER_KINDS)[number]

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
