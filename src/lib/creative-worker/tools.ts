import { tool, type Tool } from '@openai/agents'
import { z } from 'zod'
import { CREATIVE_SKILL_IDS } from '@/lib/creative-skills'
import {
  readCreativeWorkerSkillResource,
} from './skill-access'
import { CreativeWorkerError } from './errors'
import type { CreativeWorkerRunContext } from './types'

const readSkillInputSchema = z.object({
  skillId: z.enum(CREATIVE_SKILL_IDS)
    .describe('Exact registered Skill ID from the complete skillCatalog supplied in the Worker input.'),
}).strict()

function requireRunContext(
  runContext: { context: CreativeWorkerRunContext } | undefined,
): CreativeWorkerRunContext {
  if (!runContext) throw new CreativeWorkerError('CREATIVE_WORK_CONTEXT_MISSING')
  return runContext.context
}

function createReadSkillTool(): Tool<CreativeWorkerRunContext> {
  return tool({
    name: 'read_skill',
    description: 'Read one registered Creative Skill selected from the complete skillCatalog already supplied for this run. This tool is read-only and cannot access arbitrary files.',
    parameters: readSkillInputSchema,
    strict: true,
    execute: async (input, runContext) => {
      const resource = await readCreativeWorkerSkillResource({
        context: requireRunContext(runContext),
        skillId: input.skillId,
        source: 'tool',
      })
      return {
        skillId: resource.skillId,
        version: resource.version,
        uri: resource.uri,
        checksum: resource.checksum,
        content: resource.content,
      }
    },
  })
}

export function createCreativeWorkerTools(): readonly Tool<CreativeWorkerRunContext>[] {
  return [createReadSkillTool()]
}
