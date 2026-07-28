import { z } from 'zod'
import type { UIMessage } from 'ai'

/**
 * Persisted, incremental summary of conversation that has scrolled out of the
 * model's working set.
 *
 * Conversation is the one part of context that cannot be recovered: unlike a
 * tool result, there is no call to re-issue. So it is summarised rather than
 * shed — but only after the recoverable material has already been cleared,
 * because summarising costs a model call and rewrites the prompt prefix, which
 * discards the provider cache for everything after it.
 *
 * The summary is stored and extended, never recomputed. The previous summary
 * is carried into the next pass verbatim as settled fact, so this is an append
 * rather than a summary-of-a-summary; repeatedly re-compressing the same text
 * is how detail quietly bleeds away.
 */
export const PROJECT_AGENT_CONVERSATION_SUMMARY_VERSION = 1

export const projectAgentConversationSummarySchema = z.object({
  version: z.literal(PROJECT_AGENT_CONVERSATION_SUMMARY_VERSION),
  /** Last message included in `summaryText`; everything after it is still verbatim. */
  summarizedThroughMessageId: z.string().trim().min(1),
  summarizedMessageCount: z.number().int().nonnegative(),
  summaryText: z.string().trim().min(1),
}).strict()

export type ProjectAgentConversationSummary = z.infer<typeof projectAgentConversationSummarySchema>

export function parseProjectAgentConversationSummary(
  value: unknown,
): ProjectAgentConversationSummary | null {
  if (value === null || value === undefined) return null
  const parsed = projectAgentConversationSummarySchema.safeParse(value)
  // A summary written by an incompatible version is dropped rather than
  // half-read: a partially understood summary would silently misstate what the
  // model has already been told.
  return parsed.success ? parsed.data : null
}

type UnknownRecord = Record<string, unknown>

function readMessageText(message: UIMessage): string {
  return message.parts
    .flatMap((part) => {
      const record = part as UnknownRecord
      if (record.type !== 'text') return []
      const text = record.text
      return typeof text === 'string' && text.trim() ? [text.trim()] : []
    })
    .join('\n')
}

export function buildProjectAgentSummaryTranscript(messages: readonly UIMessage[]): string {
  return messages
    .map((message) => {
      const text = readMessageText(message)
      return text ? `${message.role.toUpperCase()}: ${text}` : null
    })
    .filter((line): line is string => Boolean(line))
    .join('\n')
}

/**
 * Splits the thread at the summary watermark.
 *
 * Messages already covered by a stored summary are candidates for replacement;
 * the rest stay verbatim. A watermark that no longer matches any message means
 * the thread was cleared or rewritten underneath us, so nothing is treated as
 * summarised rather than guessing an offset.
 */
export function splitProjectAgentThreadAtSummary(input: {
  messages: readonly UIMessage[]
  summary: ProjectAgentConversationSummary | null
}): { summarized: readonly UIMessage[]; verbatim: readonly UIMessage[] } {
  if (!input.summary) {
    return { summarized: [], verbatim: input.messages }
  }
  const watermarkIndex = input.messages
    .findIndex((message) => message.id === input.summary?.summarizedThroughMessageId)
  if (watermarkIndex < 0) {
    return { summarized: [], verbatim: input.messages }
  }
  return {
    summarized: input.messages.slice(0, watermarkIndex + 1),
    verbatim: input.messages.slice(watermarkIndex + 1),
  }
}

/**
 * Share of the context ceiling conversation history may hold before it starts
 * being summarised.
 *
 * Conversation is one of several context sources and the least urgent: the
 * agent's working set — project facts, the current plan, the results it just
 * fetched — is what it reasons over now. Letting an old thread crowd that out
 * would trade the material the answer depends on for material the summary can
 * carry instead.
 */
const CONVERSATION_TOKEN_LIMIT = 48_000

/**
 * Summarising aims well under the limit for the same reason shedding does:
 * rewriting the prefix discards the provider cache after that point, so a pass
 * that only just clears the threshold would pay a model call and a cache reset
 * again on the next turn.
 */
const CONVERSATION_TARGET_TOKENS = 24_000

export type ProjectAgentConversationCompactionPlan = {
  /** Messages to fold into the summary on this pass; empty means no work. */
  readonly toSummarize: readonly UIMessage[]
  /** Messages that stay verbatim in the model input. */
  readonly verbatim: readonly UIMessage[]
}

export function planProjectAgentConversationCompaction(input: {
  messages: readonly UIMessage[]
  summary: ProjectAgentConversationSummary | null
  estimateTokens: (messages: readonly UIMessage[]) => number
}): ProjectAgentConversationCompactionPlan {
  const { verbatim } = splitProjectAgentThreadAtSummary({
    messages: input.messages,
    summary: input.summary,
  })
  if (input.estimateTokens(verbatim) <= CONVERSATION_TOKEN_LIMIT) {
    return { toSummarize: [], verbatim }
  }

  // Walk forward from the oldest unsummarised message until what remains fits
  // the target, so the newest exchanges — the ones the user is still in the
  // middle of — always survive verbatim.
  let cut = 0
  while (
    cut < verbatim.length - 1
    && input.estimateTokens(verbatim.slice(cut)) > CONVERSATION_TARGET_TOKENS
  ) {
    cut += 1
  }
  if (cut === 0) return { toSummarize: [], verbatim }

  return {
    toSummarize: verbatim.slice(0, cut),
    verbatim: verbatim.slice(cut),
  }
}

export function buildProjectAgentSummaryText(
  summary: ProjectAgentConversationSummary,
): string {
  return `Summary of earlier conversation in this thread:\n${summary.summaryText}`
}
