import { tool, type Tool } from '@openai/agents'
import { z } from 'zod'
import {
  discoverCreativeWorkerSkills,
  readCreativeWorkerSkillResource,
} from './skill-access'
import { CreativeWorkerError } from './errors'
import type { CreativeWorkerRunContext } from './types'

const discoverSkillsInputSchema = z.object({
  query: z.string().trim().min(1).max(1_000)
    .describe('Describe the professional knowledge needed for the current task, such as story structure, continuity, directing, visual assets, video prompts, music, or review.'),
  tags: z.array(z.string().trim().min(1).max(120)).max(32)
    .describe('Optional narrowing terms expressed as an array; pass an empty array when query text is sufficient.'),
}).strict()

const readSkillInputSchema = z.object({
  uri: z.string().trim().min(1).max(500)
    .describe('Exact skill:// entry URI returned by discover_skills. Arbitrary file paths and invented URIs are invalid.'),
}).strict()

function requireRunContext(
  runContext: { context: CreativeWorkerRunContext } | undefined,
): CreativeWorkerRunContext {
  if (!runContext) throw new CreativeWorkerError('CREATIVE_WORK_CONTEXT_MISSING')
  return runContext.context
}

function createDiscoverSkillsTool(): Tool<CreativeWorkerRunContext> {
  return tool({
    name: 'discover_skills',
    description: 'Find relevant read-only creative skills. Returns metadata and entry URIs, not skill content.',
    parameters: discoverSkillsInputSchema,
    strict: true,
    execute: async (input, runContext) => {
      const context = requireRunContext(runContext)
      const skills = discoverCreativeWorkerSkills({
        context,
        query: input.query,
        tags: input.tags,
      })
      await context.onEvent?.({
        kind: 'skills_discovered',
        query: input.query,
        tags: input.tags,
        skillIds: skills.map((skill) => skill.id),
      })
      return { skills }
    },
  })
}

function createReadSkillTool(): Tool<CreativeWorkerRunContext> {
  return tool({
    name: 'read_skill',
    description: 'Read one registered skill:// resource. This tool is read-only and cannot access arbitrary files.',
    parameters: readSkillInputSchema,
    strict: true,
    execute: async (input, runContext) => {
      const resource = await readCreativeWorkerSkillResource({
        context: requireRunContext(runContext),
        uri: input.uri,
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
  return [
    createDiscoverSkillsTool(),
    createReadSkillTool(),
  ]
}
