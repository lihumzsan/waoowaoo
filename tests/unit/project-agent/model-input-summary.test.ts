import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import {
  parseProjectAgentConversationSummary,
  planProjectAgentConversationCompaction,
  splitProjectAgentThreadAtSummary,
} from '@/lib/project-agent/model-input/summary'
import { estimateProjectAgentUnknownTokens } from '@/lib/project-agent/model-input/estimate'

/**
 * Oracle: the watermark defines exactly which messages a stored summary
 * already covers; everything after it must reach the model verbatim, and a
 * compaction pass may only ever move that boundary forward.
 *
 * Rejects: re-summarising messages a previous pass already folded in (the
 * summary-of-a-summary drift this design exists to avoid), summarising a short
 * thread at all, condensing the newest exchange the user is still in the
 * middle of, and treating a stale or unparseable watermark as if it still
 * pointed at real messages.
 */
function message(id: string, text: string, role: 'user' | 'assistant' = 'user'): UIMessage {
  return { id, role, parts: [{ type: 'text', text }] } as UIMessage
}

const LONG = '这是一段足够长的对话内容用于触发压缩阈值。'.repeat(200)

const estimateTokens = (messages: readonly UIMessage[]) => estimateProjectAgentUnknownTokens(messages)

describe('project agent conversation summary planning', () => {
  it('leaves a short thread alone', () => {
    const messages = [message('m1', 'hello'), message('m2', 'hi', 'assistant')]
    const plan = planProjectAgentConversationCompaction({ messages, summary: null, estimateTokens })
    expect(plan.toSummarize).toEqual([])
    expect(plan.verbatim).toEqual(messages)
  })

  it('folds in only the oldest messages and keeps the newest verbatim', () => {
    const messages = Array.from({ length: 40 }, (_, index) => message(`m${index}`, LONG))
    const plan = planProjectAgentConversationCompaction({ messages, summary: null, estimateTokens })

    expect(plan.toSummarize.length).toBeGreaterThan(0)
    expect(plan.verbatim.length).toBeGreaterThan(0)
    expect([...plan.toSummarize, ...plan.verbatim]).toEqual(messages)
    // The user is still mid-exchange with the last message; condensing it would
    // drop what they just said.
    expect(plan.verbatim[plan.verbatim.length - 1]).toEqual(messages[messages.length - 1])
  })

  it('never re-summarises what a previous pass already folded in', () => {
    const messages = Array.from({ length: 40 }, (_, index) => message(`m${index}`, LONG))
    const summary = {
      version: 1 as const,
      summarizedThroughMessageId: 'm29',
      summarizedMessageCount: 30,
      summaryText: 'earlier facts',
    }
    const plan = planProjectAgentConversationCompaction({ messages, summary, estimateTokens })

    const foldedIds = plan.toSummarize.map((item) => item.id)
    const alreadyCovered = messages.slice(0, 30).map((item) => item.id)
    expect(foldedIds.filter((id) => alreadyCovered.includes(id))).toEqual([])
    expect(plan.verbatim.every((item) => !alreadyCovered.includes(item.id))).toBe(true)
  })

  it('treats a watermark that matches nothing as covering nothing', () => {
    const messages = [message('m1', 'a'), message('m2', 'b')]
    const split = splitProjectAgentThreadAtSummary({
      messages,
      summary: {
        version: 1,
        summarizedThroughMessageId: 'cleared-thread-id',
        summarizedMessageCount: 99,
        summaryText: 'stale',
      },
    })
    // Guessing an offset here would silently hide real messages from the model.
    expect(split.summarized).toEqual([])
    expect(split.verbatim).toEqual(messages)
  })

  it('drops a summary it cannot fully understand', () => {
    expect(parseProjectAgentConversationSummary(null)).toBeNull()
    expect(parseProjectAgentConversationSummary({ version: 99, summaryText: 'x' })).toBeNull()
    expect(parseProjectAgentConversationSummary({
      version: 1,
      summarizedThroughMessageId: 'm1',
      summarizedMessageCount: 2,
      summaryText: 'kept',
    })?.summaryText).toBe('kept')
  })
})
