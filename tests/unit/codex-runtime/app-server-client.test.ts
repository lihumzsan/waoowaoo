import { describe, expect, it } from 'vitest'
import { parseRuntimeSkillMetadata } from '@/lib/codex-runtime/app-server-client'

describe('Codex app-server skills/list protocol', () => {
  it('accepts and preserves the current plugin ownership field', () => {
    expect(parseRuntimeSkillMetadata({
      name: 'browser',
      description: 'Control the in-app browser.',
      path: 'C:/codex/skills/browser/SKILL.md',
      scope: 'system',
      enabled: true,
      pluginId: 'browser@openai-bundled',
    })).toEqual({
      name: 'browser',
      description: 'Control the in-app browser.',
      path: 'C:/codex/skills/browser/SKILL.md',
      scope: 'system',
      enabled: true,
      pluginId: 'browser@openai-bundled',
    })

    expect(parseRuntimeSkillMetadata({
      name: 'project-skill',
      description: 'A repository skill.',
      path: 'C:/workspace/.agents/skills/project-skill/SKILL.md',
      scope: 'repo',
      enabled: true,
      pluginId: null,
    }).pluginId).toBeNull()
  })

  it('still rejects fields outside the generated protocol contract', () => {
    expect(() => parseRuntimeSkillMetadata({
      name: 'browser',
      description: 'Control the in-app browser.',
      path: 'C:/codex/skills/browser/SKILL.md',
      scope: 'system',
      enabled: true,
      pluginId: null,
      unexpectedField: true,
    })).toThrow('SKILLS_LIST_SKILL_FIELDS_INVALID')
  })
})
