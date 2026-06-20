import type { UIMessage } from 'ai'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function rewriteValue(value: unknown, replacements: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') {
    const exact = replacements.get(value)
    if (exact) return exact
    let rewritten = value
    replacements.forEach((targetId, sourceId) => {
      rewritten = rewritten.replaceAll(sourceId, targetId)
    })
    return rewritten
  }
  if (Array.isArray(value)) return value.map((item) => rewriteValue(item, replacements))
  if (!isRecord(value)) return value

  const rewritten: Record<string, unknown> = {}
  Object.entries(value).forEach(([key, entry]) => {
    rewritten[key] = rewriteValue(entry, replacements)
  })
  return rewritten
}

export function rewriteWorkflowLabAssistantMessages(params: {
  readonly messages: readonly UIMessage[]
  readonly replacements: ReadonlyMap<string, string>
}): UIMessage[] {
  return rewriteValue(params.messages, params.replacements) as UIMessage[]
}

export function buildWorkflowLabMessageReplacementMap(params: {
  readonly sourceProjectId: string
  readonly targetProjectId: string
  readonly sourceEpisodeId: string
  readonly targetEpisodeId: string
  readonly idMap: ReadonlyMap<string, string>
}): ReadonlyMap<string, string> {
  const replacements = new Map<string, string>(params.idMap)
  replacements.set(params.sourceProjectId, params.targetProjectId)
  replacements.set(params.sourceEpisodeId, params.targetEpisodeId)
  return replacements
}
