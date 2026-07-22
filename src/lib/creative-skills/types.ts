export const CREATIVE_SKILL_LOCALES = ['zh', 'en'] as const

export type CreativeSkillLocale = (typeof CREATIVE_SKILL_LOCALES)[number]

export const CREATIVE_SKILL_IDS = [
  'creative-core',
  'story-development',
  'screenplay-canonicalization',
  'continuity-memory',
  'director-core',
  'style-development',
  'asset-development',
  'video-direction',
  'music-direction',
  'quality-review',
] as const

export type CreativeSkillId = (typeof CREATIVE_SKILL_IDS)[number]

export type CreativeSkillUri = `skill://${CreativeSkillId}/SKILL.md`

export interface LocalizedCreativeSkillText {
  readonly zh: string
  readonly en: string
}

export interface LocalizedCreativeSkillList {
  readonly zh: readonly string[]
  readonly en: readonly string[]
}

export interface CreativeSkillDefinition {
  readonly id: CreativeSkillId
  readonly version: string
  readonly title: LocalizedCreativeSkillText
  readonly summary: LocalizedCreativeSkillText
  readonly tags: readonly string[]
  readonly keywords: LocalizedCreativeSkillList
  readonly entryUri: CreativeSkillUri
  readonly resources: {
    readonly zh: 'SKILL.zh.md'
    readonly en: 'SKILL.en.md'
  }
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
  readonly locale: CreativeSkillLocale
  readonly uri: string
}

export interface CreativeSkillResource {
  readonly skillId: CreativeSkillId
  readonly version: string
  readonly locale: CreativeSkillLocale
  readonly uri: CreativeSkillUri
  readonly checksum: string
  readonly content: string
}
