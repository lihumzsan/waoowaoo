import { describe, expect, it } from 'vitest'
import type { AgentInputItem } from '@openai/agents'
import {
  collectProjectAgentFunctionCallIds,
  decideProjectAgentModelInput,
} from '@/lib/project-agent/model-input/filter'

function call(callId: string, name: string): AgentInputItem {
  return {
    type: 'function_call',
    callId,
    name,
    arguments: '{}',
  }
}

function result(callId: string, name: string): AgentInputItem {
  return {
    type: 'function_call_result',
    callId,
    name,
    status: 'completed',
    output: {
      type: 'text',
      text: '{}',
    },
  }
}

describe('project agent model input execution scope', () => {
  it('keeps complete Session history but excludes only expired discovery pairs from model input', () => {
    const staleLoad = call('load-old', 'load_tools')
    const staleLoadResult = result('load-old', 'load_tools')
    const historicalOperation = call('operation-old', 'execute_operation')
    const currentLoad = call('load-current', 'load_tools')
    const currentLoadResult = result('load-current', 'load_tools')
    const items: AgentInputItem[] = [
      { role: 'user', content: 'first turn' },
      staleLoad,
      staleLoadResult,
      historicalOperation,
      result('operation-old', 'execute_operation'),
      { role: 'user', content: 'next turn' },
      currentLoad,
      currentLoadResult,
    ]
    const staleToolDiscoveryCallIds = collectProjectAgentFunctionCallIds(
      [staleLoad, staleLoadResult, historicalOperation],
      'load_tools',
    )

    const decision = decideProjectAgentModelInput({
      modelKey: 'openrouter::openai/gpt-5.5',
      toolSchemaTokens: 0,
      locale: 'en',
      irreplaceableToolNames: new Set(),
      staleToolDiscoveryCallIds,
    }, {
      input: items,
    })

    expect(items).toContain(staleLoad)
    expect(items).toContain(staleLoadResult)
    expect(decision.input).not.toContain(staleLoad)
    expect(decision.input).not.toContain(staleLoadResult)
    expect(decision.input).toContain(historicalOperation)
    expect(decision.input).toContain(currentLoad)
    expect(decision.input).toContain(currentLoadResult)
  })
})
