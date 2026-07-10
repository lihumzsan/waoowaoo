export type HistoricalDefectSeverity = 'P0' | 'P1' | 'P2'

export type ArchitectureModuleId =
  | 'assistant-run-lifecycle'
  | 'async-task-lifecycle'
  | 'canvas-node'
  | 'provider-gateway'
  | 'billing-approval'

export type TestLayer =
  | 'unit'
  | 'integration-api'
  | 'integration-provider'
  | 'integration-chain'
  | 'integration-task'
  | 'system'
  | 'regression'
  | 'contract'
  | 'guard'

export type HistoricalDefectReplayMode = 'direct-parent' | 'semantic-fault-injection'

export type HistoricalDefectStatus =
  | 'cataloged'
  | 'scenario-required'
  | 'protected'
  | 'production-fix-required'

export type HistoricalDefect = {
  readonly id: string
  readonly commits: readonly string[]
  readonly symptom: string
  readonly rootCause: string
  readonly severity: HistoricalDefectSeverity
  readonly module: ArchitectureModuleId
  readonly invariantIds: readonly string[]
  readonly affectedLayers: readonly TestLayer[]
  readonly escapedLayers: readonly TestLayer[]
  readonly scenarioIds: readonly string[]
  readonly replayMode: HistoricalDefectReplayMode
  readonly status: HistoricalDefectStatus
}
