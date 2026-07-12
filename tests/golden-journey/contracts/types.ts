import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'

export const GOLDEN_SCENARIO_RESULT = {
  PASS: 'PASS',
  SYSTEM_FAIL: 'SYSTEM_FAIL',
  EXPECTED_FAILURE: 'EXPECTED_FAILURE',
  INFRASTRUCTURE_FAIL: 'INFRASTRUCTURE_FAIL',
} as const

export type GoldenScenarioResult = (typeof GOLDEN_SCENARIO_RESULT)[keyof typeof GOLDEN_SCENARIO_RESULT]

export type GoldenScenarioKind =
  | 'mainline'
  | 'product_journey'
  | 'stage_probe'
  | 'model_variant'
  | 'infrastructure_variant'

export type GoldenExpectedTerminal =
  | {
    readonly kind: 'workflow_stage'
    readonly stage: EditFirstWorkflowStage
    readonly allowFailedRun: false
  }
  | {
    readonly kind: 'declared_failure'
    readonly code: string
    readonly allowFailedRun: true
    readonly requireNoPartialEffects: true
  }
  | {
    readonly kind: 'product_fact'
    readonly fact: string
    readonly allowFailedRun: false
  }

export interface GoldenScenarioContract {
  readonly id: string
  readonly kind: GoldenScenarioKind
  readonly title: string
  readonly startStage: EditFirstWorkflowStage | 'outside_workflow'
  readonly expectedTerminal: GoldenExpectedTerminal
  readonly modelBehavior: string
  readonly requiresBrowser: true
  readonly requiresMySql: true
  readonly requiresRedis: true
  readonly requiresWorkers: boolean
  readonly zeroPaidProviderCalls: true
}

export interface GoldenStageCoverage {
  readonly stage: EditFirstWorkflowStage
  readonly scenarioIds: readonly string[]
}
