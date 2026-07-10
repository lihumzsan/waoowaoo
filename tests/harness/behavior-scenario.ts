import type { HistoricalDefectSeverity, TestLayer } from '../history/types'

export type ScenarioContext = {
  readonly recordExecution: (scenarioId: string) => void
}

export type BehaviorScenario<TIdentity extends string> = {
  readonly id: string
  readonly identity: TIdentity
  readonly severity: HistoricalDefectSeverity
  readonly invariantIds: readonly string[]
  readonly historicalDefectIds: readonly string[]
  readonly layers: readonly TestLayer[]
  readonly execute: (context: ScenarioContext) => Promise<void>
}

export type ScenarioExecutionDiff = {
  readonly missing: readonly string[]
  readonly unexpected: readonly string[]
  readonly duplicates: readonly string[]
}

export type ScenarioExecutionLedger = {
  readonly recordExecution: (scenarioId: string) => void
  readonly compare: () => ScenarioExecutionDiff
  readonly assertExact: () => void
}

export function createScenarioExecutionLedger(expectedScenarioIds: readonly string[]): ScenarioExecutionLedger {
  const expected = new Set(expectedScenarioIds)
  if (expected.size !== expectedScenarioIds.length) {
    throw new Error('Expected scenario ids must be unique')
  }

  const executionCounts = new Map<string, number>()

  function compare(): ScenarioExecutionDiff {
    const executed = new Set(executionCounts.keys())
    return {
      missing: [...expected].filter((scenarioId) => !executed.has(scenarioId)).sort(),
      unexpected: [...executed].filter((scenarioId) => !expected.has(scenarioId)).sort(),
      duplicates: [...executionCounts.entries()]
        .filter(([, count]) => count > 1)
        .map(([scenarioId]) => scenarioId)
        .sort(),
    }
  }

  return {
    recordExecution(scenarioId) {
      if (!scenarioId) {
        throw new Error('Executed scenario id must be non-empty')
      }
      executionCounts.set(scenarioId, (executionCounts.get(scenarioId) ?? 0) + 1)
    },
    compare,
    assertExact() {
      const diff = compare()
      if (diff.missing.length || diff.unexpected.length || diff.duplicates.length) {
        throw new Error(`Scenario execution mismatch: ${JSON.stringify(diff)}`)
      }
    },
  }
}
