import { describe, expect, it } from 'vitest'
import type { AgentInputItem } from '@openai/agents'
import {
  buildProjectAgentSummaryInputItem,
  parseProjectAgentConversationSummaryItem,
  planProjectAgentConversationCompaction,
  splitProjectAgentSessionSummary,
} from '@/lib/project-agent/model-input/summary'

const LONG = '这是一段足够长的对话内容，用于触发模型 Session 压缩阈值。'.repeat(250)

function user(text: string): AgentInputItem {
  return { role: 'user', content: text } satisfies AgentInputItem
}

function assistant(text: string): AgentInputItem {
  return {
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text }],
  } satisfies AgentInputItem
}

function toolTurn(index: number, text = LONG): AgentInputItem[] {
  const callId = `call-${String(index)}`
  return [
    user(`user-${String(index)} ${text}`),
    {
      type: 'function_call',
      callId,
      name: 'request_choice',
      status: 'completed',
      arguments: JSON.stringify({
        card: {
          options: [
            { value: 'a', label: `方案 A ${text}` },
            { value: 'b', label: `方案 B ${text}` },
          ],
        },
      }),
    },
    {
      type: 'function_call_result',
      callId,
      name: 'request_choice',
      status: 'completed',
      output: { type: 'text', text: JSON.stringify({ emitted: true }) },
    },
    assistant(`assistant-${String(index)}`),
  ] as AgentInputItem[]
}

describe('project agent SDK Session compaction planning', () => {
  it('leaves a short structured transcript untouched', () => {
    const items = [user('hello'), assistant('hi')]
    const plan = planProjectAgentConversationCompaction(items)
    expect(plan.toSummarize).toEqual([])
    expect(plan.verbatim).toEqual(items)
  })

  it('cuts only at user-turn boundaries and keeps call/result pairs together', () => {
    const items = Array.from({ length: 12 }, (_, index) => toolTurn(index)).flat()
    const plan = planProjectAgentConversationCompaction(items)

    expect(plan.toSummarize.length).toBeGreaterThan(0)
    expect(plan.verbatim.length).toBeGreaterThan(0)
    expect([...plan.toSummarize, ...plan.verbatim]).toEqual(items)
    expect(plan.verbatim[0]).toMatchObject({ role: 'user' })

    const summarizedCallIds = new Set(plan.toSummarize.flatMap((item) => (
      'type' in item && item.type === 'function_call' ? [item.callId] : []
    )))
    const summarizedResultIds = new Set(plan.toSummarize.flatMap((item) => (
      'type' in item && item.type === 'function_call_result' ? [item.callId] : []
    )))
    expect(summarizedResultIds).toEqual(summarizedCallIds)
  })

  it('carries the previous Session summary once instead of summarising it again', () => {
    const prior = {
      version: 1 as const,
      summarizedItemCount: 30,
      summaryText: 'earlier facts',
    }
    const summaryItem = buildProjectAgentSummaryInputItem(prior)
    const items = [
      summaryItem,
      ...Array.from({ length: 12 }, (_, index) => toolTurn(index)).flat(),
    ]
    const plan = planProjectAgentConversationCompaction(items)

    expect(plan.previousSummary).toEqual(prior)
    expect(plan.toSummarize).not.toContain(summaryItem)
    expect(plan.verbatim).not.toContain(summaryItem)
  })

  it('recognizes only the complete versioned summary item', () => {
    const summary = {
      version: 1 as const,
      summarizedItemCount: 8,
      summaryText: 'kept',
    }
    const item = buildProjectAgentSummaryInputItem(summary)
    expect(parseProjectAgentConversationSummaryItem(item)).toEqual(summary)
    expect(parseProjectAgentConversationSummaryItem(user('[conversation_summary]broken'))).toBeNull()

    const items = [item, user('new turn')]
    expect(splitProjectAgentSessionSummary(items)).toEqual({
      summary,
      verbatim: [items[1]],
    })
  })
})
