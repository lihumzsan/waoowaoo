import type { AgentInputItem } from '@openai/agents'
import { z } from 'zod'
import { estimateProjectAgentUnknownTokens } from './estimate'

export const PROJECT_AGENT_CONVERSATION_SUMMARY_VERSION = 1

export const projectAgentConversationSummarySchema = z.object({
  version: z.literal(PROJECT_AGENT_CONVERSATION_SUMMARY_VERSION),
  summarizedItemCount: z.number().int().nonnegative(),
  summaryText: z.string().trim().min(1),
}).strict()

export type ProjectAgentConversationSummary = z.infer<typeof projectAgentConversationSummarySchema>

const SUMMARY_HEADER = /^\[conversation_summary version=1 summarized_items=(\d+)\]\n([\s\S]+)\n\[\/conversation_summary\]$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readStringMessageContent(item: AgentInputItem): string | null {
  const record = item as unknown
  if (!isRecord(record) || record.role !== 'user') return null
  return typeof record.content === 'string' ? record.content : null
}

export function parseProjectAgentConversationSummaryItem(
  item: AgentInputItem | undefined,
): ProjectAgentConversationSummary | null {
  if (!item) return null
  const content = readStringMessageContent(item)
  const match = content?.match(SUMMARY_HEADER)
  if (!match) return null
  const summarizedItemCount = Number(match[1])
  const summaryText = match[2]?.trim() ?? ''
  const parsed = projectAgentConversationSummarySchema.safeParse({
    version: PROJECT_AGENT_CONVERSATION_SUMMARY_VERSION,
    summarizedItemCount,
    summaryText,
  })
  return parsed.success ? parsed.data : null
}

export function buildProjectAgentSummaryInputItem(
  summary: ProjectAgentConversationSummary,
): AgentInputItem {
  return {
    role: 'user',
    content: [
      `[conversation_summary version=${String(summary.version)} summarized_items=${String(summary.summarizedItemCount)}]`,
      summary.summaryText,
      '[/conversation_summary]',
    ].join('\n'),
  } satisfies AgentInputItem
}

/**
 * The summary is an ordinary SDK input item at the head of Session history.
 * No parallel summary field or UI-message watermark is needed.
 */
export function splitProjectAgentSessionSummary(items: readonly AgentInputItem[]): {
  summary: ProjectAgentConversationSummary | null
  verbatim: readonly AgentInputItem[]
} {
  const summary = parseProjectAgentConversationSummaryItem(items[0])
  return summary
    ? { summary, verbatim: items.slice(1) }
    : { summary: null, verbatim: items }
}

export function buildProjectAgentSummaryTranscript(items: readonly AgentInputItem[]): string {
  return items.map((item) => JSON.stringify(item)).join('\n')
}

const CONVERSATION_TOKEN_LIMIT = 48_000
const CONVERSATION_TARGET_TOKENS = 24_000

export type ProjectAgentConversationCompactionPlan = {
  readonly previousSummary: ProjectAgentConversationSummary | null
  readonly toSummarize: readonly AgentInputItem[]
  readonly verbatim: readonly AgentInputItem[]
}

function isUserMessage(item: AgentInputItem | undefined): boolean {
  const value = item as unknown
  return !!item && isRecord(value) && value.role === 'user'
}

/**
 * Cuts only at a later user-message boundary. This keeps every assistant tool
 * call and matching result inside one side of the cut instead of manufacturing
 * orphan protocol items.
 */
export function planProjectAgentConversationCompaction(
  items: readonly AgentInputItem[],
): ProjectAgentConversationCompactionPlan {
  const split = splitProjectAgentSessionSummary(items)
  if (estimateProjectAgentUnknownTokens(split.verbatim) <= CONVERSATION_TOKEN_LIMIT) {
    return {
      previousSummary: split.summary,
      toSummarize: [],
      verbatim: split.verbatim,
    }
  }

  for (let cut = 1; cut < split.verbatim.length; cut += 1) {
    if (!isUserMessage(split.verbatim[cut])) continue
    const remaining = split.verbatim.slice(cut)
    if (estimateProjectAgentUnknownTokens(remaining) > CONVERSATION_TARGET_TOKENS) continue
    return {
      previousSummary: split.summary,
      toSummarize: split.verbatim.slice(0, cut),
      verbatim: remaining,
    }
  }

  // A single oversized turn cannot be cut without risking call/result
  // causality. Per-step recoverable tool-result shedding remains responsible
  // for that case.
  return {
    previousSummary: split.summary,
    toSummarize: [],
    verbatim: split.verbatim,
  }
}
