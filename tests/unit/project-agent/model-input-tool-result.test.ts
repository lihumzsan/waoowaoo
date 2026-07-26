import { describe, expect, it } from 'vitest'
import type { AgentInputItem } from '@openai/agents'
import { shedProjectAgentToolResults } from '@/lib/project-agent/model-input/tool-result'

/**
 * Oracle: after shedding, the model must still know every call it made, with
 * what arguments and how it ended; only recoverable result bodies may lose
 * their content, oldest first, and only until the target is met.
 *
 * Rejects: dropping the call record (the model would redo completed work),
 * clearing the newest results (an immediate re-read that frees nothing),
 * clearing a result whose content exists nowhere else, clearing everything
 * when a fraction suffices, and re-clearing an already-cleared placeholder.
 */
function call(callId: string, name: string): AgentInputItem {
  return {
    type: 'function_call',
    callId,
    name,
    status: 'completed',
    arguments: JSON.stringify({ id: callId }),
  } as unknown as AgentInputItem
}

function result(callId: string, name: string, body: string): AgentInputItem {
  return {
    type: 'function_call_result',
    callId,
    name,
    status: 'completed',
    output: { type: 'text', text: body },
  } as unknown as AgentInputItem
}

const BIG = 'screenplay body '.repeat(400)

function transcript(count: number, name = 'get_resource'): AgentInputItem[] {
  return Array.from({ length: count }, (_, index) => [
    call(`c${index}`, name),
    result(`c${index}`, name, `${BIG}${index}`),
  ]).flat()
}

function outputTextOf(item: AgentInputItem): string {
  const output = (item as { output?: { text?: string } }).output
  return output?.text ?? ''
}

describe('project agent tool result shedding', () => {
  it('keeps every call record while clearing result bodies', () => {
    const items = transcript(10)
    const shed = shedProjectAgentToolResults({
      items,
      locale: 'zh',
      keepRecentResults: 2,
      targetFreedTokens: 1_000,
      irreplaceableToolNames: new Set(),
    })

    const calls = shed.items.filter((item) => (item as { type?: string }).type === 'function_call')
    expect(calls).toEqual(items.filter((item) => (item as { type?: string }).type === 'function_call'))
    expect(shed.clearedResultCount).toBeGreaterThan(0)
    expect(shed.freedTokens).toBeGreaterThan(0)
  })

  it('leaves the most recent results untouched', () => {
    const items = transcript(10)
    const shed = shedProjectAgentToolResults({
      items,
      locale: 'zh',
      keepRecentResults: 3,
      targetFreedTokens: Number.MAX_SAFE_INTEGER,
      irreplaceableToolNames: new Set(),
    })

    const results = shed.items.filter((item) => (item as { type?: string }).type === 'function_call_result')
    expect(results).toHaveLength(10)
    for (const recent of results.slice(-3)) {
      expect(outputTextOf(recent)).toContain('screenplay body')
    }
    expect(shed.clearedResultCount).toBe(7)
  })

  it('never clears a result whose content exists nowhere else', () => {
    const items = [
      ...transcript(4, 'request_choice'),
      ...transcript(4, 'get_resource'),
    ]
    const shed = shedProjectAgentToolResults({
      items,
      locale: 'zh',
      keepRecentResults: 0,
      targetFreedTokens: Number.MAX_SAFE_INTEGER,
      irreplaceableToolNames: new Set(['request_choice']),
    })

    const choiceResults = shed.items.filter((item) => (
      (item as { type?: string }).type === 'function_call_result'
      && (item as { name?: string }).name === 'request_choice'
    ))
    expect(choiceResults).toHaveLength(4)
    for (const choice of choiceResults) {
      expect(outputTextOf(choice)).toContain('screenplay body')
    }
    expect(shed.clearedResultCount).toBe(4)
  })

  it('stops as soon as the target is met instead of clearing everything', () => {
    const items = transcript(10)
    const oneResultTokens = Math.floor(BIG.length / 4)
    const shed = shedProjectAgentToolResults({
      items,
      locale: 'zh',
      keepRecentResults: 0,
      targetFreedTokens: oneResultTokens,
      irreplaceableToolNames: new Set(),
    })
    expect(shed.clearedResultCount).toBeLessThan(10)
    expect(shed.freedTokens).toBeGreaterThanOrEqual(oneResultTokens)
  })

  it('does not re-clear an already cleared result', () => {
    const items = transcript(6)
    const first = shedProjectAgentToolResults({
      items,
      locale: 'zh',
      keepRecentResults: 0,
      targetFreedTokens: Number.MAX_SAFE_INTEGER,
      irreplaceableToolNames: new Set(),
    })
    const second = shedProjectAgentToolResults({
      items: first.items,
      locale: 'zh',
      keepRecentResults: 0,
      targetFreedTokens: Number.MAX_SAFE_INTEGER,
      irreplaceableToolNames: new Set(),
    })
    expect(first.clearedResultCount).toBe(6)
    expect(second.clearedResultCount).toBe(0)
    expect(second.freedTokens).toBe(0)
  })

  it('tells the model the call already ran so it does not redo the work', () => {
    const shed = shedProjectAgentToolResults({
      items: transcript(3, 'create_image'),
      locale: 'en',
      keepRecentResults: 0,
      targetFreedTokens: Number.MAX_SAFE_INTEGER,
      irreplaceableToolNames: new Set(),
    })
    const cleared = shed.items.find((item) => (
      (item as { type?: string }).type === 'function_call_result'
    ))
    expect(outputTextOf(cleared as AgentInputItem)).toContain('already ran')
    expect(outputTextOf(cleared as AgentInputItem)).toContain('create_image')
  })
})
