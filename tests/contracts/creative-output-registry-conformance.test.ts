import { describe, expect, it } from 'vitest'
import {
  CREATIVE_OUTPUT_REGISTRY,
  CREATIVE_OUTPUT_SCHEMAS,
  CREATIVE_WORKER_OUTPUT_KIND,
  creativeOutputJsonSchema,
} from '@/lib/creative-skills/output-registry'
import { CREATIVE_SKILL_REGISTRY } from '@/lib/creative-skills/registry'
import { CREATIVE_WORKER_REGISTRY } from '@/lib/creative-skills/agent-profiles'
import { CREATIVE_OUTPUT_KINDS, CREATIVE_WORKER_KINDS } from '@/lib/creative-skills/types'
import { requireWorkspaceResourceSchema } from '@/lib/workspace-resource/schema-registry'

describe('Creative output registry conformance', () => {
  it('binds every fixed worker to exactly one Skill, outputKind, strict schema, and Workspace schema', () => {
    expect(Object.keys(CREATIVE_OUTPUT_REGISTRY).sort()).toEqual([...CREATIVE_OUTPUT_KINDS].sort())
    expect(Object.keys(CREATIVE_WORKER_REGISTRY).sort()).toEqual([...CREATIVE_WORKER_KINDS].sort())

    for (const workerKind of CREATIVE_WORKER_KINDS) {
      const worker = CREATIVE_WORKER_REGISTRY[workerKind]
      const outputKind = CREATIVE_WORKER_OUTPUT_KIND[workerKind]
      const output = CREATIVE_OUTPUT_REGISTRY[outputKind]
      expect(worker.outputKind, workerKind).toBe(outputKind)
      expect(output.workerKind, workerKind).toBe(workerKind)
      expect(worker.skillIds, workerKind).toEqual(['creative-core', output.professionalSkillId])
      expect(CREATIVE_SKILL_REGISTRY[output.professionalSkillId], workerKind).toBeDefined()
      expect(CREATIVE_OUTPUT_SCHEMAS[outputKind], workerKind).toBe(output.schema)
      expect(requireWorkspaceResourceSchema(output.savedDocumentSchemaId).mediaType, workerKind).toBe('text')

      const jsonSchema = creativeOutputJsonSchema(outputKind)
      expect(jsonSchema.additionalProperties, workerKind).toBe(false)
      expect(JSON.stringify(jsonSchema), workerKind).toContain(`\"const\":\"${outputKind}\"`)
    }
  })
})
