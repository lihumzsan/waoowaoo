import { describe, expect, it } from 'vitest'
import type { AgentInputItem } from '@openai/agents'
import {
  collectProjectAgentBoundToolDiscoveryCallIds,
  decideProjectAgentModelInput,
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
  it('keeps static definitions but excludes expired bound discovery pairs from model input', () => {
    const staleLoad = call(
      'load-old',
      'load_tools',
      JSON.stringify({ toolIds: ['create_image'] }),
    )
    const staleLoadResult = result('load-old', 'load_tools')
    const staticLoad = call(
      'load-static',
      'load_tools',
      JSON.stringify({ toolIds: ['generate_voice'] }),
    )
    const staticLoadResult = result('load-static', 'load_tools')
    const historicalOperation = call('operation-old', 'execute_operation')
    const currentLoad = call('load-current', 'load_tools')
    const currentLoadResult = result('load-current', 'load_tools')
    const items: AgentInputItem[] = [
      { role: 'user', content: 'first turn' },
      staleLoad,
      staleLoadResult,
      staticLoad,
      staticLoadResult,
      historicalOperation,
      result('operation-old', 'execute_operation'),
      { role: 'user', content: 'next turn' },
      currentLoad,
      currentLoadResult,
    ]
    const staleBoundToolDiscoveryCallIds = collectProjectAgentBoundToolDiscoveryCallIds(
      [staleLoad, staleLoadResult, staticLoad, staticLoadResult, historicalOperation],
      'load_tools',
      new Set(['create_image']),
    )

    const decision = decideProjectAgentModelInput({
      modelKey: 'openrouter::openai/gpt-5.5',
      toolSchemaTokens: 0,
      locale: 'en',
      irreplaceableToolNames: new Set(),
      staleBoundToolDiscoveryCallIds,
    }, {
      input: items,
    })

    expect(items).toContain(staleLoad)
    expect(items).toContain(staleLoadResult)
    expect(decision.input).not.toContain(staleLoad)
    expect(decision.input).not.toContain(staleLoadResult)
    expect(decision.input).toContain(staticLoad)
    expect(decision.input).toContain(staticLoadResult)
    expect(decision.input).toContain(historicalOperation)
    expect(decision.input).toContain(currentLoad)
    expect(decision.input).toContain(currentLoadResult)
  })

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
      staleBoundToolDiscoveryCallIds: new Set(),
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
