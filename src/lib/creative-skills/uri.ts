import { CREATIVE_SKILL_IDS } from './types'
import type { CreativeSkillId, CreativeSkillUri } from './types'

const URI_PATTERN = /^skill:\/\/([a-z0-9]+(?:-[a-z0-9]+)*)\/SKILL\.md$/

export function isCreativeSkillId(value: string): value is CreativeSkillId {
  return (CREATIVE_SKILL_IDS as readonly string[]).includes(value)
}

export function parseCreativeSkillUri(uri: string): {
  readonly skillId: CreativeSkillId
  readonly uri: CreativeSkillUri
} {
  const match = URI_PATTERN.exec(uri)
  if (!match) {
    throw new Error(`CREATIVE_SKILL_URI_INVALID:${uri}`)
  }

  const skillId = match[1]
  if (!skillId || !isCreativeSkillId(skillId)) {
    throw new Error(`CREATIVE_SKILL_NOT_FOUND:${skillId ?? ''}`)
  }

  return { skillId, uri: `skill://${skillId}/SKILL.md` }
}
