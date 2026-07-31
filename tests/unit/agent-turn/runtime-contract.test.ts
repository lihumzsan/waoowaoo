import { Agent, RunContext, RunState } from '@openai/agents'
import { describe, expect, it } from 'vitest'
import {
  AGENT_TURN_RUN_STATE_SCHEMA_VERSION,
  assertAgentTurnRunStateContract,
  buildAgentTurnRuntimeContract,
  parseAgentTurnRuntimeContract,
} from '@/lib/agent-turn/runtime-contract'

describe('Agent Turn runtime contract', () => {
  it('matches the RunState schema emitted by the pinned Agents SDK', () => {
    const agent = new Agent({
      name: 'agent-turn-runtime-contract-probe',
      instructions: 'Probe the durable RunState serialization contract.',
    })
    const state = new RunState(
      new RunContext<Record<string, never>>({}),
      [],
      agent,
      1,
    )
    const runState = state.toString()
    const serialized = JSON.parse(runState) as unknown

    expect(serialized).toMatchObject({
      $schemaVersion: AGENT_TURN_RUN_STATE_SCHEMA_VERSION,
    })
    expect(() => {
      assertAgentTurnRunStateContract({
        runState,
        runtime: buildAgentTurnRuntimeContract(),
      })
    }).not.toThrow()
  })

  it('fails closed when the frozen SDK or RunState schema diverges', () => {
    const current = buildAgentTurnRuntimeContract()
    expect(() => {
      parseAgentTurnRuntimeContract({
        ...current,
        agentsSdkVersion: '0.13.1',
      })
    }).toThrow('AGENT_TURN_RUNTIME_CONTRACT_DIVERGED')

    expect(() => {
      assertAgentTurnRunStateContract({
        runState: JSON.stringify({ $schemaVersion: '1.12' }),
        runtime: current,
      })
    }).toThrow('AGENT_TURN_RUN_STATE_CONTRACT_DIVERGED')
  })
})
