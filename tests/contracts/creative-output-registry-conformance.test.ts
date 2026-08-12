import { describe, expect, it } from 'vitest'
import {
  CREATIVE_OUTPUT_REGISTRY,
  CREATIVE_OUTPUT_SCHEMAS,
  CREATIVE_DOMAIN_OUTPUT_KIND,
  creativeOutputJsonSchema,
} from '@/lib/creative-skills/output-registry'
import { CREATIVE_SKILL_REGISTRY } from '@/lib/creative-skills/registry'
import { CREATIVE_RUNTIME_SKILL_REGISTRY } from '@/lib/creative-skills/runtime-skills'
import { CREATIVE_DOMAIN_KINDS, CREATIVE_OUTPUT_KINDS } from '@/lib/creative-skills/types'
import { requireWorkspaceResourceSchema } from '@/lib/workspace-resource/schema-registry'
import {
  PRODUCTION_PROFILE_IDS,
  PRODUCTION_PROFILE_REGISTRY,
} from '@/lib/production-profile'
import { creativeRuntimeSkillsForProfile } from '@/lib/creative-skills/runtime-skills'

describe('Creative output registry conformance', () => {
  it('binds every creative domain to exactly one Skill, outputKind, strict schema, and Workspace schema', () => {
    expect(Object.keys(CREATIVE_OUTPUT_REGISTRY).sort()).toEqual([...CREATIVE_OUTPUT_KINDS].sort())
    expect(Object.keys(CREATIVE_RUNTIME_SKILL_REGISTRY).sort()).toEqual([...CREATIVE_DOMAIN_KINDS].sort())

    for (const domainKind of CREATIVE_DOMAIN_KINDS) {
      const runtimeSkill = CREATIVE_RUNTIME_SKILL_REGISTRY[domainKind]
      const outputKind = CREATIVE_DOMAIN_OUTPUT_KIND[domainKind]
      const output = CREATIVE_OUTPUT_REGISTRY[outputKind]
      expect(runtimeSkill.outputKind, domainKind).toBe(outputKind)
      expect(output.domainKind, domainKind).toBe(domainKind)
      expect(runtimeSkill.skillIds, domainKind).toEqual(['creative-core', output.professionalSkillId])
      expect(CREATIVE_SKILL_REGISTRY[output.professionalSkillId], domainKind).toBeDefined()
      expect(CREATIVE_OUTPUT_SCHEMAS[outputKind], domainKind).toBe(output.schema)
      expect(requireWorkspaceResourceSchema(output.savedDocumentSchemaId).mediaType, domainKind).toBe('text')

      const jsonSchema = creativeOutputJsonSchema(outputKind)
      expect(jsonSchema.additionalProperties, domainKind).toBe(false)
      expect(JSON.stringify(jsonSchema), domainKind).toContain(`\"const\":\"${outputKind}\"`)
    }
  })

  it('materializes exactly the creative domains allowed by every production profile', () => {
    expect(Object.keys(PRODUCTION_PROFILE_REGISTRY).sort()).toEqual(
      [...PRODUCTION_PROFILE_IDS].sort(),
    )
    for (const profileId of PRODUCTION_PROFILE_IDS) {
      const profile = PRODUCTION_PROFILE_REGISTRY[profileId]
      expect(new Set(profile.allowedDomains).size, profileId).toBe(profile.allowedDomains.length)
      expect(
        creativeRuntimeSkillsForProfile(profile).map((skill) => skill.kind),
        profileId,
      ).toEqual(profile.allowedDomains)
      for (const domainKind of profile.allowedDomains) {
        expect(CREATIVE_RUNTIME_SKILL_REGISTRY[domainKind], `${profileId}:${domainKind}`).toBeDefined()
        expect(CREATIVE_OUTPUT_REGISTRY[CREATIVE_DOMAIN_OUTPUT_KIND[domainKind]], `${profileId}:${domainKind}`).toBeDefined()
      }
    }
  })
})
