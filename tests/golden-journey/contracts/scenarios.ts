import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'
import type {
  GoldenScenarioContract,
  GoldenStageCoverage,
} from './types'
import { goldenNextWorkflowStage } from './transitions'
import { GOLDEN_CHECKPOINTABLE_STAGES, GOLDEN_EDIT_FIRST_WORKFLOW_STAGES } from './stages'
export { GOLDEN_EDIT_FIRST_WORKFLOW_STAGES } from './stages'

const REQUIRED_INFRASTRUCTURE = {
  requiresBrowser: true,
  requiresMySql: true,
  requiresRedis: true,
  requiresWorkers: true,
  zeroPaidProviderCalls: true,
} as const

export const GOLDEN_MAINLINE_SCENARIO = {
  id: 'GJ-MAIN-STORY-TO-FINAL-DELIVERABLE',
  kind: 'mainline',
  title: 'empty episode reaches a durable final video through the real browser workflow',
  startStage: 'not_started',
  expectedTerminal: {
    kind: 'workflow_stage',
    stage: 'completed',
    allowFailedRun: false,
  },
  modelBehavior: 'normal-mainline',
  ...REQUIRED_INFRASTRUCTURE,
} as const satisfies GoldenScenarioContract

function stageProbeId(stage: EditFirstWorkflowStage): string {
  return `GJ-STAGE-${stage.toUpperCase().replaceAll('_', '-')}`
}

export const GOLDEN_STAGE_PROBE_SCENARIOS: readonly GoldenScenarioContract[] =
  GOLDEN_CHECKPOINTABLE_STAGES.map((stage) => ({
    id: stageProbeId(stage),
    kind: 'stage_probe',
    title: `canonical ${stage} checkpoint remains valid and reaches its next declared boundary`,
    startStage: stage,
    expectedTerminal: {
      kind: 'workflow_stage',
      stage: goldenNextWorkflowStage(stage) ?? stage,
      allowFailedRun: false,
    },
    modelBehavior: 'normal-mainline',
    ...REQUIRED_INFRASTRUCTURE,
  }))

export const GOLDEN_MODEL_VARIANT_SCENARIOS = [
  {
    id: 'GJ-MODEL-STOPS-AFTER-CONFIRM',
    kind: 'model_variant',
    title: 'deterministic workflow continuation survives a model that stops after confirmation',
    startStage: 'bible_ready_for_review',
    expectedTerminal: {
      kind: 'workflow_stage',
      stage: 'ready_to_generate_style_previews',
      allowFailedRun: false,
    },
    modelBehavior: 'stop-after-successful-confirmation',
    ...REQUIRED_INFRASTRUCTURE,
  },
  {
    id: 'GJ-MODEL-DUPLICATES-TOOL-CALL',
    kind: 'model_variant',
    title: 'duplicate model tool calls create one durable effect',
    startStage: 'ready_to_generate_bible',
    expectedTerminal: {
      kind: 'workflow_stage',
      stage: 'bible_generating',
      allowFailedRun: false,
    },
    modelBehavior: 'duplicate-tool-call',
    ...REQUIRED_INFRASTRUCTURE,
  },
  {
    id: 'GJ-MODEL-STREAM-DISCONNECT',
    kind: 'model_variant',
    title: 'model stream disconnect leaves only committed recoverable facts',
    startStage: 'ready_to_ingest_script',
    expectedTerminal: {
      kind: 'declared_failure',
      code: 'MODEL_STREAM_DISCONNECTED',
      allowFailedRun: true,
      requireNoPartialEffects: true,
    },
    modelBehavior: 'disconnect-mid-tool-call',
    ...REQUIRED_INFRASTRUCTURE,
  },
] as const satisfies readonly GoldenScenarioContract[]

export const GOLDEN_INFRASTRUCTURE_VARIANT_SCENARIOS = [
  {
    id: 'GJ-WORKER-RETRY',
    kind: 'infrastructure_variant',
    title: 'one retryable provider failure reaches one eventual resource',
    startStage: 'not_started',
    expectedTerminal: {
      kind: 'workflow_stage',
      stage: 'completed',
      allowFailedRun: false,
    },
    modelBehavior: 'normal-mainline',
    ...REQUIRED_INFRASTRUCTURE,
  },
  {
    id: 'GJ-APPROVAL-DOUBLE-SUBMIT',
    kind: 'infrastructure_variant',
    title: 'two approval submissions create one grant and one execution',
    startStage: 'ready_to_generate_videos',
    expectedTerminal: {
      kind: 'workflow_stage',
      stage: 'videos_generating',
      allowFailedRun: false,
    },
    modelBehavior: 'normal-stage-probe',
    ...REQUIRED_INFRASTRUCTURE,
  },
  {
    id: 'GJ-CHOICE-DOUBLE-SUBMIT',
    kind: 'infrastructure_variant',
    title: 'two browser submissions consume one Choice and create one continuation',
    startStage: 'script_ready_for_review',
    expectedTerminal: {
      kind: 'workflow_stage',
      stage: 'bible_ready_for_review',
      allowFailedRun: false,
    },
    modelBehavior: 'normal-stage-probe',
    ...REQUIRED_INFRASTRUCTURE,
  },
  {
    id: 'GJ-CHOICE-LEGAL-WATERMARK-ADVANCE',
    kind: 'infrastructure_variant',
    title: 'a Choice remains consumable after a legal Run watermark advance',
    startStage: 'script_ready_for_review',
    expectedTerminal: {
      kind: 'workflow_stage',
      stage: 'bible_ready_for_review',
      allowFailedRun: false,
    },
    modelBehavior: 'normal-stage-probe',
    ...REQUIRED_INFRASTRUCTURE,
  },
  {
    id: 'GJ-RELOAD-EACH-SUSPENSION',
    kind: 'infrastructure_variant',
    title: 'Choice Approval Task and terminal boundaries recover after browser reload',
    startStage: 'not_started',
    expectedTerminal: {
      kind: 'workflow_stage',
      stage: 'completed',
      allowFailedRun: false,
    },
    modelBehavior: 'normal-mainline',
    ...REQUIRED_INFRASTRUCTURE,
  },
  {
    id: 'GJ-PROVIDER-NONRETRYABLE-FAILURE',
    kind: 'infrastructure_variant',
    title: 'terminal provider failure is explicit and creates no fabricated resource',
    startStage: 'not_started',
    expectedTerminal: {
      kind: 'declared_failure',
      code: 'LOCAL_PROVIDER_TERMINAL_FAILURE',
      allowFailedRun: true,
      requireNoPartialEffects: true,
    },
    modelBehavior: 'normal-mainline',
    ...REQUIRED_INFRASTRUCTURE,
  },
] as const satisfies readonly GoldenScenarioContract[]

export const GOLDEN_SCENARIO_CONTRACTS: readonly GoldenScenarioContract[] = [
  GOLDEN_MAINLINE_SCENARIO,
  ...GOLDEN_STAGE_PROBE_SCENARIOS,
  ...GOLDEN_MODEL_VARIANT_SCENARIOS,
  ...GOLDEN_INFRASTRUCTURE_VARIANT_SCENARIOS,
]

export const GOLDEN_STAGE_COVERAGE: readonly GoldenStageCoverage[] =
  GOLDEN_EDIT_FIRST_WORKFLOW_STAGES.map((stage) => ({
    stage,
    scenarioIds: [
      GOLDEN_MAINLINE_SCENARIO.id,
      ...(GOLDEN_CHECKPOINTABLE_STAGES.includes(stage as (typeof GOLDEN_CHECKPOINTABLE_STAGES)[number])
        ? [stageProbeId(stage)]
        : []),
    ],
  }))

export function validateGoldenScenarioContracts(
  scenarios: readonly GoldenScenarioContract[] = GOLDEN_SCENARIO_CONTRACTS,
): void {
  const ids = new Set<string>()
  for (const scenario of scenarios) {
    if (ids.has(scenario.id)) throw new Error(`GOLDEN_SCENARIO_ID_DUPLICATE:${scenario.id}`)
    ids.add(scenario.id)
    if (!scenario.zeroPaidProviderCalls) {
      throw new Error(`GOLDEN_SCENARIO_PAID_PROVIDER_FORBIDDEN:${scenario.id}`)
    }
  }

  const coverageByStage = new Map(GOLDEN_STAGE_COVERAGE.map((coverage) => [coverage.stage, coverage]))
  for (const stage of GOLDEN_EDIT_FIRST_WORKFLOW_STAGES) {
    const coverage = coverageByStage.get(stage)
    if (!coverage || coverage.scenarioIds.length === 0) {
      throw new Error(`GOLDEN_WORKFLOW_STAGE_UNCOVERED:${stage}`)
    }
    for (const scenarioId of coverage.scenarioIds) {
      if (!ids.has(scenarioId)) throw new Error(`GOLDEN_STAGE_SCENARIO_UNKNOWN:${stage}:${scenarioId}`)
    }
  }
}
