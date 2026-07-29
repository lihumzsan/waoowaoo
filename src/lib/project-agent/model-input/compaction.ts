import type { AgentInputItem } from '@openai/agents'
import type { ProjectAgentModelSession } from '../model-session'
import { extendProjectAgentConversationSummary } from './summarizer'
import {
  buildProjectAgentSummaryInputItem,
  planProjectAgentConversationCompaction,
} from './summary'

export type ProjectAgentConversationCompaction = {
  readonly historyItems: readonly AgentInputItem[]
  readonly compacted: {
    readonly summarizedItemCount: number
    readonly summaryText: string
  } | null
}

/**
 * Compacts the SDK transcript in the Session buffer. The replacement becomes
 * durable only when the surrounding Run/Choice/Approval settlement commits.
 */
export async function compactProjectAgentConversation(input: {
  session: ProjectAgentModelSession
  userId: string
  signal?: AbortSignal
  onFailure: (error: unknown) => void
}): Promise<ProjectAgentConversationCompaction> {
  const historyItems = await input.session.getItems()
  const plan = planProjectAgentConversationCompaction(historyItems)
  if (plan.toSummarize.length === 0) {
    return { historyItems, compacted: null }
  }

  let summary = null
  try {
    summary = await extendProjectAgentConversationSummary({
      userId: input.userId,
      previous: plan.previousSummary,
      newlySummarized: plan.toSummarize,
      ...(input.signal ? { signal: input.signal } : {}),
    })
  } catch (error) {
    input.onFailure(error)
  }
  if (!summary) return { historyItems, compacted: null }

  const compactedHistory = [
    buildProjectAgentSummaryInputItem(summary),
    ...plan.verbatim,
  ]
  await input.session.replaceItems(compactedHistory)
  return {
    historyItems: compactedHistory,
    compacted: {
      summarizedItemCount: plan.toSummarize.length,
      summaryText: summary.summaryText,
    },
  }
}
