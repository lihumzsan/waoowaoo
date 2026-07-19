import { CREATIVE_SKILLS } from './registry'
import { assertCreativeSkillLocale } from './uri'
import type {
  CreativeSkillDefinition,
  CreativeSkillDiscovery,
  DiscoverCreativeSkillsInput,
} from './types'

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ')
}

function matchesRequestedTags(
  definition: CreativeSkillDefinition,
  requestedTags: readonly string[],
): boolean {
  const available = new Set(definition.tags.map(normalize))
  return requestedTags.every((tag) => available.has(normalize(tag)))
}

function scoreSkill(definition: CreativeSkillDefinition, input: DiscoverCreativeSkillsInput): number {
  const query = normalize(input.query)
  if (!query) return 1

  const localTitle = normalize(definition.title[input.locale])
  const localSummary = normalize(definition.summary[input.locale])
  const localizedKeywords = definition.keywords[input.locale].map(normalize)
  const allKeywords = [...definition.keywords.zh, ...definition.keywords.en].map(normalize)
  const tags = definition.tags.map(normalize)
  let score = 0

  if (localTitle === query) score += 100
  if (localTitle.includes(query) || query.includes(localTitle)) score += 40
  if (localSummary.includes(query)) score += 25

  for (const keyword of localizedKeywords) {
    if (query === keyword) score += 30
    else if (query.includes(keyword) || keyword.includes(query)) score += 12
  }
  for (const keyword of allKeywords) {
    if (query.includes(keyword)) score += 6
  }
  for (const tag of tags) {
    if (query.includes(tag)) score += 8
  }

  const queryTerms = query.split(/[\s,，。.!！？:：;；/]+/u).filter(Boolean)
  const searchText = normalize([
    definition.id,
    definition.title.zh,
    definition.title.en,
    definition.summary.zh,
    definition.summary.en,
    ...definition.tags,
    ...definition.keywords.zh,
    ...definition.keywords.en,
  ].join(' '))
  for (const term of queryTerms) {
    if (searchText.includes(term)) score += 3
  }

  return score
}

export function discoverCreativeSkills(
  input: DiscoverCreativeSkillsInput,
): readonly CreativeSkillDiscovery[] {
  assertCreativeSkillLocale(input.locale)
  const requestedTags = input.tags?.filter((tag) => normalize(tag).length > 0) ?? []

  return CREATIVE_SKILLS
    .map((definition, registryIndex) => ({
      definition,
      registryIndex,
      score: scoreSkill(definition, input),
    }))
    .filter(({ definition, score }) => (
      score > 0 && matchesRequestedTags(definition, requestedTags)
    ))
    .sort((left, right) => right.score - left.score || left.registryIndex - right.registryIndex)
    .map(({ definition }) => ({
      id: definition.id,
      version: definition.version,
      title: definition.title[input.locale],
      summary: definition.summary[input.locale],
      tags: definition.tags,
      entryUri: definition.entryUri,
    }))
}
