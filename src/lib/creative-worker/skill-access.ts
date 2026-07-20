import {
  CREATIVE_SKILLS,
  getCreativeSkillDefinition,
  readCreativeSkillResource,
  type CreativeSkillDiscovery,
  type CreativeSkillId,
  type CreativeSkillLocale,
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

function assertResourceBudget(
  context: CreativeWorkerRunContext,
  resource: CreativeSkillResource,
): void {
  const contentChars = resource.content.length
  if (contentChars > context.budgets.maxSingleSkillResourceChars) {
    throw new CreativeWorkerError('CREATIVE_WORK_RESOURCE_BUDGET_EXCEEDED', {
      uri: resource.uri,
      contentChars,
      maxSingleSkillResourceChars: context.budgets.maxSingleSkillResourceChars,
    })
  }
  if (context.counters.skillContentChars + contentChars > context.budgets.maxSkillContentChars) {
    throw new CreativeWorkerError('CREATIVE_WORK_CONTENT_BUDGET_EXCEEDED', {
      uri: resource.uri,
      contentChars,
      consumedChars: context.counters.skillContentChars,
      maxSkillContentChars: context.budgets.maxSkillContentChars,
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
  assertReadBudget(input.context)
  const definition = getCreativeSkillDefinition(input.skillId)
  const resource = await readCreativeSkillResource({
    locale: input.context.locale,
    uri: definition.entryUri,
  })
  assertResourceBudget(input.context, resource)
  await recordRead(input.context, resource, input.source)
  return resource
}

export function listCreativeWorkerSkillCatalog(
  locale: CreativeSkillLocale,
): readonly CreativeSkillDiscovery[] {
  return CREATIVE_SKILLS.map((definition) => ({
    id: definition.id,
    version: definition.version,
    title: definition.title[locale],
    summary: definition.summary[locale],
    tags: definition.tags,
    entryUri: definition.entryUri,
  }))
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
