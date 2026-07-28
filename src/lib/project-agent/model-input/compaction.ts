import type { UIMessage } from 'ai'
import type { AgentInputItem } from '@openai/agents'
import { prisma } from '@/lib/prisma'
import {
  replaceProjectAssistantThreadSummaryInTransaction,
  type ProjectAssistantThreadIdentity,
} from '../persistence'
import { estimateProjectAgentUnknownTokens } from './estimate'
import { extendProjectAgentConversationSummary } from './summarizer'
import {
  buildProjectAgentSummaryText,
  parseProjectAgentConversationSummary,
  planProjectAgentConversationCompaction,
  splitProjectAgentThreadAtSummary,
  type ProjectAgentConversationSummary,
} from './summary'

/**
 * Applies the stored conversation summary and, when the thread has outgrown
 * its allowance, extends it.
 *
 * This is the last resort in the context hierarchy. Tool results are shed
 * first because they can be re-fetched; conversation cannot, so condensing it
 * always loses something. It also costs a model call and rewrites the prompt
 * prefix, discarding the provider cache from that point — which is why it runs
 * at turn boundaries and aims well under the threshold rather than at it.
 */
export type ProjectAgentConversationCompaction = {
  /** Messages that remain verbatim; the summary covers everything before them. */
  readonly messages: UIMessage[]
  /** Prepended so the model sees the condensed history as context, not as a turn. */
  readonly summaryInputItem: AgentInputItem | null
  /** Present only when this turn actually summarised something. */
  readonly compacted: {
    readonly summarizedMessageCount: number
    readonly summaryText: string
  } | null
}

function buildSummaryInputItem(
  summary: ProjectAgentConversationSummary,
): AgentInputItem {
  // Carried as a user-role item on purpose. The converter that builds model
  // input only emits user and assistant roles, and an earlier implementation
  // lost its summary entirely by using a role that silently fell through.
  return {
    role: 'user',
    content: buildProjectAgentSummaryText(summary),
  } as AgentInputItem
}

export async function compactProjectAgentConversation(input: ProjectAssistantThreadIdentity & {
  messages: UIMessage[]
  signal?: AbortSignal
  onFailure: (error: unknown) => void
}): Promise<ProjectAgentConversationCompaction> {
  const record = await prisma.projectAssistantThread.findFirst({
    where: {
      projectId: input.projectId,
      userId: input.userId,
      assistantId: input.assistantId,
      scopeRef: input.episodeId ? `episode:${input.episodeId}` : `project:${input.projectId}`,
    },
    select: { summaryJson: true },
  })
  const storedSummary = parseProjectAgentConversationSummary(record?.summaryJson)

  const plan = planProjectAgentConversationCompaction({
    messages: input.messages,
    summary: storedSummary,
    estimateTokens: (messages) => estimateProjectAgentUnknownTokens(messages),
  })

  if (plan.toSummarize.length === 0) {
    return {
      messages: [...plan.verbatim],
      summaryInputItem: storedSummary ? buildSummaryInputItem(storedSummary) : null,
      compacted: null,
    }
  }

  let nextSummary: ProjectAgentConversationSummary | null = null
  try {
    nextSummary = await extendProjectAgentConversationSummary({
      userId: input.userId,
      previous: storedSummary,
      newlySummarized: plan.toSummarize,
      ...(input.signal ? { signal: input.signal } : {}),
    })
  } catch (error) {
    input.onFailure(error)
    nextSummary = null
  }

  // A failed or empty summary leaves the thread exactly as it was. Losing the
  // optimisation is acceptable; dropping messages the summary never captured
  // would silently erase conversation the user can still see on screen.
  if (!nextSummary || nextSummary === storedSummary) {
    const { verbatim } = splitProjectAgentThreadAtSummary({
      messages: input.messages,
      summary: storedSummary,
    })
    return {
      messages: [...verbatim],
      summaryInputItem: storedSummary ? buildSummaryInputItem(storedSummary) : null,
      compacted: null,
    }
  }

  await prisma.$transaction(async (tx) => {
    await replaceProjectAssistantThreadSummaryInTransaction(tx, {
      projectId: input.projectId,
      userId: input.userId,
      assistantId: input.assistantId,
      ...(input.episodeId ? { episodeId: input.episodeId } : {}),
      summaryJson: {
        version: nextSummary.version,
        summarizedThroughMessageId: nextSummary.summarizedThroughMessageId,
        summarizedMessageCount: nextSummary.summarizedMessageCount,
        summaryText: nextSummary.summaryText,
      },
    })
  })

  return {
    messages: [...plan.verbatim],
    summaryInputItem: buildSummaryInputItem(nextSummary),
    compacted: {
      summarizedMessageCount: plan.toSummarize.length,
      summaryText: nextSummary.summaryText,
    },
  }
}
