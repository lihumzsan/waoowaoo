import { describe, expect, it } from 'vitest'
import { createScenarioExecutionLedger } from '../../harness/behavior-scenario'
import { runLifecycleSequence } from '../../harness/lifecycle-sequence'

type Facts = {
  readonly task: 'absent' | 'processing' | 'completed'
  readonly stream: 'absent' | 'active' | 'stale'
}

type View = 'pending' | 'streaming' | 'succeeded'

function resolveView(facts: Facts): View {
  if (facts.task === 'completed') return 'succeeded'
  if (facts.task === 'processing' && facts.stream === 'active') return 'streaming'
  return 'pending'
}

describe('lifecycle sequence harness', () => {
  it('feeds explicit fact snapshots to the resolver without interpreting event timing', () => {
    const ledger = createScenarioExecutionLedger(['SCENARIO-LIFECYCLE'])
    const observedSteps: string[] = []

    runLifecycleSequence({
      scenarioId: 'SCENARIO-LIFECYCLE',
      steps: [
        {
          id: 'processing',
          facts: { task: 'processing', stream: 'active' },
          expected: 'streaming',
        },
        {
          id: 'terminal-rejects-stale-stream',
          facts: { task: 'completed', stream: 'stale' },
          expected: 'succeeded',
        },
      ],
      resolve: resolveView,
      assertStep({ stepId, view, expected }) {
        observedSteps.push(stepId)
        expect(view).toBe(expected)
      },
    }, ledger)

    expect(observedSteps).toEqual(['processing', 'terminal-rejects-stale-stream'])
    expect(() => ledger.assertExact()).not.toThrow()
  })

  it('rejects duplicate step identities before recording scenario execution', () => {
    const ledger = createScenarioExecutionLedger(['SCENARIO-DUPLICATE'])

    expect(() => runLifecycleSequence({
      scenarioId: 'SCENARIO-DUPLICATE',
      steps: [
        { id: 'same', facts: { task: 'absent', stream: 'absent' }, expected: 'pending' },
        { id: 'same', facts: { task: 'completed', stream: 'absent' }, expected: 'succeeded' },
      ],
      resolve: resolveView,
      assertStep() {},
    }, ledger)).toThrow('duplicate step id same')
    expect(ledger.compare().missing).toEqual(['SCENARIO-DUPLICATE'])
  })
})
