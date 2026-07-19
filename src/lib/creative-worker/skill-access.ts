import {
  discoverCreativeSkills,
  readCreativeSkillResource,
  type CreativeSkillId,
  type CreativeSkillResource,
} from '@/lib/creative-skills'
import { CreativeWorkerError } from './errors'
import type {
  CreativeWorkerRunContext,
  CreativeSkillReadTraceEntry,
} from './types'

export interface RequiredCreativeSkill {
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
  uri: string
  source: CreativeSkillReadTraceEntry['source']
}): Promise<CreativeSkillResource> {
  assertReadBudget(input.context)
  const resource = await readCreativeSkillResource({
    locale: input.context.locale,
    uri: input.uri,
  })
  assertResourceBudget(input.context, resource)
  await recordRead(input.context, resource, input.source)
  return resource
}

export function discoverCreativeWorkerSkills(input: {
  context: CreativeWorkerRunContext
  query: string
  tags: readonly string[]
}) {
  if (input.context.counters.discoveryCalls >= input.context.budgets.maxDiscoveryCalls) {
    throw new CreativeWorkerError('CREATIVE_WORK_DISCOVERY_BUDGET_EXCEEDED', {
      maxDiscoveryCalls: input.context.budgets.maxDiscoveryCalls,
    })
  }
  input.context.counters.discoveryCalls += 1
  return discoverCreativeSkills({
    locale: input.context.locale,
    query: input.query,
    tags: input.tags,
  })
}

export async function loadRequiredCreativeSkills(input: {
  context: CreativeWorkerRunContext
  skillIds: readonly CreativeSkillId[]
  signal: AbortSignal
}): Promise<readonly RequiredCreativeSkill[]> {
  const requiredSkills: RequiredCreativeSkill[] = []
  for (const skillId of input.skillIds) {
    if (input.signal.aborted) {
      throw new CreativeWorkerError('CREATIVE_WORK_ABORTED')
    }
    const exactMatches = discoverCreativeSkills({
      locale: input.context.locale,
      query: skillId,
    }).filter((candidate) => candidate.id === skillId)
    if (exactMatches.length !== 1) {
      throw new CreativeWorkerError('CREATIVE_WORK_REQUIRED_SKILL_NOT_FOUND', {
        skillId,
        matches: exactMatches.length,
      })
    }
    const definition = exactMatches[0]
    const resource = await readCreativeWorkerSkillResource({
      context: input.context,
      uri: definition.entryUri,
      source: 'required',
    })
    requiredSkills.push({
      id: resource.skillId,
      uri: resource.uri,
      version: resource.version,
      checksum: resource.checksum,
      content: resource.content,
    })
  }
  return requiredSkills
}
