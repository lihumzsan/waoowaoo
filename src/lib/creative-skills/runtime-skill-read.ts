import { CREATIVE_SKILL_IDS, type CreativeSkillId } from './types'

export type CreativeRuntimeSkillId = Exclude<CreativeSkillId, 'creative-core'>

const CREATIVE_RUNTIME_SKILL_READ_TOOL_PREFIX = 'skill_read.'
const READ_COMMAND_PATTERN = /(?:^|[\s"'])(?:\/(?:usr\/)?bin\/)?(?:cat|head|sed|tail)(?=$|[\s"'])/u

function isCreativeRuntimeSkillId(value: string): value is CreativeRuntimeSkillId {
  return value !== 'creative-core'
    && CREATIVE_SKILL_IDS.some((skillId) => skillId === value)
}

/**
 * Recognize the explicit read of one materialized Wao Skill. The command is
 * the runtime execution fact; command output is never parsed to infer usage.
 */
export function resolveCreativeRuntimeSkillReadCommand(command: unknown): CreativeRuntimeSkillId | null {
  if (typeof command !== 'string' || !READ_COMMAND_PATTERN.test(command)) return null
  for (const skillId of CREATIVE_SKILL_IDS) {
    if (skillId === 'creative-core') continue
    if (command.includes(`/skills/${skillId}/SKILL.md`)) return skillId
  }
  return null
}

export function creativeRuntimeSkillReadToolName(
  skillId: CreativeRuntimeSkillId,
): `${typeof CREATIVE_RUNTIME_SKILL_READ_TOOL_PREFIX}${CreativeRuntimeSkillId}` {
  return `${CREATIVE_RUNTIME_SKILL_READ_TOOL_PREFIX}${skillId}`
}

export function parseCreativeRuntimeSkillReadToolName(
  toolName: string,
): CreativeRuntimeSkillId | null {
  if (!toolName.startsWith(CREATIVE_RUNTIME_SKILL_READ_TOOL_PREFIX)) return null
  const skillId = toolName.slice(CREATIVE_RUNTIME_SKILL_READ_TOOL_PREFIX.length)
  return isCreativeRuntimeSkillId(skillId) ? skillId : null
}
