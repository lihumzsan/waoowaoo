import type { UIMessage } from 'ai'
import { rewriteWorkflowLabValue } from './clone-json'

export function rewriteWorkflowLabAssistantMessages(params: {
  readonly messages: readonly UIMessage[]
  readonly replacements: ReadonlyMap<string, string>
}): UIMessage[] {
  return [...rewriteWorkflowLabValue(params.messages, params.replacements)]
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
