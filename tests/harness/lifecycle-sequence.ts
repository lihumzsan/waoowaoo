import type { ScenarioExecutionLedger } from './behavior-scenario'

export type LifecycleSequenceStep<TFacts, TExpected> = {
  readonly id: string
  readonly facts: TFacts
  readonly expected: TExpected
}

export type LifecycleSequenceScenario<TFacts, TView, TExpected> = {
  readonly scenarioId: string
  readonly steps: readonly LifecycleSequenceStep<TFacts, TExpected>[]
  readonly resolve: (facts: TFacts) => TView
  readonly assertStep: (input: {
    readonly scenarioId: string
    readonly stepId: string
    readonly view: TView
    readonly expected: TExpected
  }) => void
}

export function runLifecycleSequence<TFacts, TView, TExpected>(
  scenario: LifecycleSequenceScenario<TFacts, TView, TExpected>,
  ledger: Pick<ScenarioExecutionLedger, 'recordExecution'>,
): void {
  if (!scenario.scenarioId) {
    throw new Error('Lifecycle scenario id must be non-empty')
  }
  if (scenario.steps.length === 0) {
    throw new Error(`Lifecycle scenario ${scenario.scenarioId} must contain at least one step`)
  }

  const stepIds = new Set<string>()
  for (const step of scenario.steps) {
    if (!step.id) {
      throw new Error(`Lifecycle scenario ${scenario.scenarioId} has an empty step id`)
    }
    if (stepIds.has(step.id)) {
      throw new Error(`Lifecycle scenario ${scenario.scenarioId} has duplicate step id ${step.id}`)
    }
    stepIds.add(step.id)

    scenario.assertStep({
      scenarioId: scenario.scenarioId,
      stepId: step.id,
      view: scenario.resolve(step.facts),
      expected: step.expected,
    })
  }

  ledger.recordExecution(scenario.scenarioId)
}
