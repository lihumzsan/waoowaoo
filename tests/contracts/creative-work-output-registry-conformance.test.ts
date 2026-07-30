import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  CREATIVE_SKILL_IDS,
  CREATIVE_SKILL_REGISTRY,
} from '@/lib/creative-skills'
import {
  CREATIVE_WORK_OUTPUT_KINDS,
  creativeWorkOutputRegistry,
  creativeWorkOutputSchemas,
} from '@/lib/creative-worker'

const REMOVED_OUTPUT_KINDS = [
  'story_canon',
  'chapter_plan',
  'continuity_analysis',
] as const

describe('creative work output registry conformance', () => {
  it('keeps output identities, schemas, and professional skills exhaustive', () => {
    const outputKinds = [...CREATIVE_WORK_OUTPUT_KINDS].sort()
    const registryKinds = Object.keys(creativeWorkOutputRegistry).sort()
    const schemaKinds = Object.keys(creativeWorkOutputSchemas).sort()

    expect(registryKinds).toEqual(outputKinds)
    expect(schemaKinds).toEqual(outputKinds)

    const professionalSkillIds = outputKinds.map((outputKind) => {
      const definition = creativeWorkOutputRegistry[outputKind]
      const kindSchema = definition.schema.shape.kind

      expect(definition.kind).toBe(outputKind)
      expect(definition.schema).toBe(creativeWorkOutputSchemas[outputKind])
      expect(kindSchema).toBeInstanceOf(z.ZodLiteral)
      expect(kindSchema.value).toBe(outputKind)
      expect(definition.professionalSkillId).not.toBe('creative-core')
      expect(CREATIVE_SKILL_REGISTRY[definition.professionalSkillId]?.id)
        .toBe(definition.professionalSkillId)

      return definition.professionalSkillId
    })

    expect(new Set(professionalSkillIds).size).toBe(professionalSkillIds.length)
    expect(['creative-core', ...professionalSkillIds].sort())
      .toEqual([...CREATIVE_SKILL_IDS].sort())
    expect(Object.keys(CREATIVE_SKILL_REGISTRY).sort())
      .toEqual([...CREATIVE_SKILL_IDS].sort())

    for (const removedKind of REMOVED_OUTPUT_KINDS) {
      expect(registryKinds).not.toContain(removedKind)
      expect(schemaKinds).not.toContain(removedKind)
    }
  })
})
