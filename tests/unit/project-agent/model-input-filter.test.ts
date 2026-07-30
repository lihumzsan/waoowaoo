import { describe, expect, it } from 'vitest'
import type { AgentInputItem } from '@openai/agents'
import {
  prepareProjectAgentContextCompressionInput,
} from '@/lib/project-agent/model-input/filter'

function call(callId: string, name: string, argumentsJson = '{}'): AgentInputItem {
  return {
    type: 'function_call',
    callId,
    name,
    arguments: argumentsJson,
  }
}

function result(callId: string, name: string, text = '{}'): AgentInputItem {
  return {
    type: 'function_call_result',
    callId,
    name,
    status: 'completed',
    output: {
      type: 'text',
      text,
    },
  }
}

describe('project agent model input execution scope', () => {
  it('feeds one compression the same losslessly cleared historical results', () => {
    const oldResult = result('operation-old', 'get_project_assets', 'x'.repeat(10_000))
    const recentResults = Array.from({ length: 5 }, (_, index) => (
      result(`operation-recent-${String(index)}`, 'get_project_assets')
    ))
    const input = [
      call('operation-old', 'get_project_assets'),
      oldResult,
      ...recentResults.flatMap((item, index) => [
        call(`operation-recent-${String(index)}`, 'get_project_assets'),
        item,
      ]),
    ]
    const prepared = prepareProjectAgentContextCompressionInput({
      modelKey: 'openrouter::openai/gpt-5.5',
      toolSchemaTokens: 0,
      locale: 'en',
      irreplaceableToolNames: new Set(),
    }, input, 1)

    expect(prepared).toHaveLength(input.length)
    expect(prepared[1]).toMatchObject({
      type: 'function_call_result',
      output: {
        clearedByContextBudget: true,
      },
    })
    expect(prepared.at(-1)).toBe(recentResults.at(-1))
  })
})
