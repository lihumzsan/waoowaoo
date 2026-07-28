import {
  getCreativeSkillDefinition,
  readCreativeSkillResource,
  type CreativeSkillDiscovery,
  type CreativeSkillId,
  type CreativeSkillResource,
} from '@/lib/creative-skills'
import { CreativeWorkerError } from './errors'
import type {
  CreativeWorkerRunContext,
  CreativeSkillReadTraceEntry,
} from './types'

export interface PreloadedCreativeSkill {
  id: CreativeSkillId
  uri: string
  version: string
  checksum: string
  content: string
}

function assertReadBudget(context: CreativeWorkerRunContext): void {
  if (context.counters.readCalls >= context.budgets.maxReadCalls) {
    throw new CreativeWorkerError('CREATIVE_WORK_READ_BUDGET_EXCEEDED', {
      maxReadCalls: context.budgets.maxReadCalls,
    })
  }
}

async function recordRead(
  context: CreativeWorkerRunContext,
  resource: CreativeSkillResource,
  source: CreativeSkillReadTraceEntry['source'],
): Promise<void> {
  const contentChars = resource.content.length
  context.counters.readCalls += 1
  context.counters.skillContentChars += contentChars
  const trace: CreativeSkillReadTraceEntry = {
    ordinal: context.skillTrace.length + 1,
    source,
    skillId: resource.skillId,
    version: resource.version,
    uri: resource.uri,
    checksum: resource.checksum,
    contentChars,
  }
  context.skillTrace.push(trace)
  await context.onEvent?.({
    kind: 'skill_read',
    trace,
  })
}

export async function readCreativeWorkerSkillResource(input: {
  context: CreativeWorkerRunContext
  skillId: CreativeSkillId
  source: CreativeSkillReadTraceEntry['source']
}): Promise<CreativeSkillResource> {
  const definition = getCreativeSkillDefinition(input.skillId)
  const resource = await readCreativeSkillResource({
    uri: definition.entryUri,
  })
  // Parallel reads may all begin before the first filesystem read settles, so
  // claim the read budget immediately before recordRead synchronously
  // increments the shared counters.
  assertReadBudget(input.context)
  await recordRead(input.context, resource, input.source)
  return resource
}

export function listCreativeWorkerSkillCatalog(
  professionalSkillId: Exclude<CreativeSkillId, 'creative-core'>,
): readonly CreativeSkillDiscovery[] {
  const definition = getCreativeSkillDefinition(professionalSkillId)
  return [{
    id: definition.id,
    version: definition.version,
    title: definition.title,
    summary: definition.summary,
    tags: definition.tags,
    entryUri: definition.entryUri,
  }]
}

export async function loadPreloadedCreativeSkills(input: {
  context: CreativeWorkerRunContext
  skillIds: readonly CreativeSkillId[]
  signal: AbortSignal
}): Promise<readonly PreloadedCreativeSkill[]> {
  const preloadedSkills: PreloadedCreativeSkill[] = []
  for (const skillId of input.skillIds) {
    if (input.signal.aborted) {
      throw new CreativeWorkerError('CREATIVE_WORK_ABORTED')
    }
    const resource = await readCreativeWorkerSkillResource({
      context: input.context,
      skillId,
      source: 'preloaded',
    })
    preloadedSkills.push({
      id: resource.skillId,
      uri: resource.uri,
      version: resource.version,
      checksum: resource.checksum,
      content: resource.content,
    })
  }
  return preloadedSkills
}
