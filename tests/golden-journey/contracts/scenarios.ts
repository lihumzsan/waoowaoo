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

export const GOLDEN_DOWNSTREAM_CONTINUATION_SCENARIO = {
  id: 'GJ-DOWNSTREAM-CHECKPOINT-TO-FINAL-DELIVERABLE',
  kind: 'mainline',
  title: 'a production Workflow Lab checkpoint continues through the real browser workflow to a durable final video',
  startStage: 'script_ready_for_review',
  expectedTerminal: {
    kind: 'workflow_stage',
    stage: 'completed',
    allowFailedRun: false,
  },
  modelBehavior: 'normal-mainline',
  ...REQUIRED_INFRASTRUCTURE,
} as const satisfies GoldenScenarioContract

export const GOLDEN_PRODUCT_JOURNEY_SCENARIOS = [
  {
    id: 'GJ-AUTH-UNAUTHENTICATED-DENIAL',
    kind: 'product_journey',
    title: 'an unauthenticated browser is redirected from workspace and receives no project API data',
    startStage: 'outside_workflow',
    expectedTerminal: {
      kind: 'product_fact',
      fact: 'unauthenticated_workspace_access_denied',
      allowFailedRun: false,
    },
    modelBehavior: 'none',
    ...REQUIRED_INFRASTRUCTURE,
    requiresWorkers: false,
  },
  {
    id: 'GJ-AUTH-SESSION-RECOVERY',
    kind: 'product_journey',
    title: 'a registered user keeps a durable session across reload and can sign out and sign in again',
    startStage: 'outside_workflow',
    expectedTerminal: {
      kind: 'product_fact',
      fact: 'authenticated_session_restored_after_logout',
      allowFailedRun: false,
    },
    modelBehavior: 'none',
    ...REQUIRED_INFRASTRUCTURE,
    requiresWorkers: false,
  },
  {
    id: 'GJ-PROJECT-CRUD-DURABILITY',
    kind: 'product_journey',
    title: 'a project owner creates searches edits reloads and deletes one durable project through the UI',
    startStage: 'outside_workflow',
    expectedTerminal: {
      kind: 'product_fact',
      fact: 'project_crud_persisted',
      allowFailedRun: false,
    },
    modelBehavior: 'none',
    ...REQUIRED_INFRASTRUCTURE,
    requiresWorkers: false,
  },
  {
    id: 'GJ-PROJECT-CROSS-USER-ISOLATION',
    kind: 'product_journey',
    title: 'a second authenticated user cannot list read mutate open or delete the owner project',
    startStage: 'outside_workflow',
    expectedTerminal: {
      kind: 'product_fact',
      fact: 'cross_user_project_access_denied',
      allowFailedRun: false,
    },
    modelBehavior: 'none',
    ...REQUIRED_INFRASTRUCTURE,
    requiresWorkers: false,
  },
  {
    id: 'GJ-PROJECT-CREATE-RESPONSE-LOSS',
    kind: 'product_journey',
    title: 'a project committed by the server remains discoverable exactly once after the browser loses the response',
    startStage: 'outside_workflow',
    expectedTerminal: {
      kind: 'product_fact',
      fact: 'committed_project_recovers_after_response_loss',
      allowFailedRun: false,
    },
    modelBehavior: 'none',
    ...REQUIRED_INFRASTRUCTURE,
    requiresWorkers: false,
  },
  {
    id: 'GJ-I18N-CRITICAL-PROJECT',
    kind: 'product_journey',
    title: 'an English registration and project creation survives the product language switch to Chinese with one identity',
    startStage: 'outside_workflow',
    expectedTerminal: {
      kind: 'product_fact',
      fact: 'project_identity_preserved_across_locale_switch',
      allowFailedRun: false,
    },
    modelBehavior: 'none',
    ...REQUIRED_INFRASTRUCTURE,
    requiresWorkers: false,
  },
  {
    id: 'GJ-DEPLOY-SELF-HOSTED-CAPABILITIES',
    kind: 'product_journey',
    title: 'self-hosted public capability facts match the authentication and navigation surfaces',
    startStage: 'outside_workflow',
    expectedTerminal: {
      kind: 'product_fact',
      fact: 'self_hosted_capabilities_match_ui',
      allowFailedRun: false,
    },
    modelBehavior: 'none',
    ...REQUIRED_INFRASTRUCTURE,
    requiresWorkers: false,
  },
  {
    id: 'GJ-ASSET-HUB-PROJECT-REUSE',
    kind: 'product_journey',
    title: 'an edited global character can be reimported and deleted while one isolated project copy remains durable',
    startStage: 'outside_workflow',
    expectedTerminal: {
      kind: 'product_fact',
      fact: 'global_character_reused_by_project',
      allowFailedRun: false,
    },
    modelBehavior: 'none',
    ...REQUIRED_INFRASTRUCTURE,
    requiresWorkers: false,
  },
  {
    id: 'GJ-ASSET-HUB-CROSS-PROJECT-DENIAL',
    kind: 'product_journey',
    title: 'one authenticated project cannot overwrite an asset owned by another user and project',
    startStage: 'outside_workflow',
    expectedTerminal: {
      kind: 'product_fact',
      fact: 'cross_project_asset_mutation_denied',
      allowFailedRun: false,
    },
    modelBehavior: 'none',
    ...REQUIRED_INFRASTRUCTURE,
    requiresWorkers: false,
  },
] as const satisfies readonly GoldenScenarioContract[]

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
    id: 'GJ-TASK-COMPLETES-DURING-BROWSER-DISCONNECT',
    kind: 'infrastructure_variant',
    title: 'a production Task completes while the page is disconnected and a new page restores the next durable stage',
    startStage: 'ready_to_generate_videos',
    expectedTerminal: {
      kind: 'workflow_stage',
      stage: 'ready_to_render_chapters',
      allowFailedRun: false,
    },
    modelBehavior: 'normal-stage-probe',
    ...REQUIRED_INFRASTRUCTURE,
  },
  {
    id: 'GJ-SSE-OLD-CURSOR-REPLAY',
    kind: 'infrastructure_variant',
    title: 'a browser reconnects with an older durable cursor and real server replay preserves one current result',
    startStage: 'ready_to_generate_videos',
    expectedTerminal: {
      kind: 'workflow_stage',
      stage: 'ready_to_render_chapters',
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
  GOLDEN_DOWNSTREAM_CONTINUATION_SCENARIO,
  ...GOLDEN_PRODUCT_JOURNEY_SCENARIOS,
  ...GOLDEN_STAGE_PROBE_SCENARIOS,
  ...GOLDEN_MODEL_VARIANT_SCENARIOS,
  ...GOLDEN_INFRASTRUCTURE_VARIANT_SCENARIOS,
]

export const GOLDEN_STAGE_COVERAGE: readonly GoldenStageCoverage[] =
  GOLDEN_EDIT_FIRST_WORKFLOW_STAGES.map((stage) => ({
    stage,
    scenarioIds: [
      GOLDEN_MAINLINE_SCENARIO.id,
      ...(GOLDEN_EDIT_FIRST_WORKFLOW_STAGES.indexOf(stage)
        >= GOLDEN_EDIT_FIRST_WORKFLOW_STAGES.indexOf(GOLDEN_DOWNSTREAM_CONTINUATION_SCENARIO.startStage)
        ? [GOLDEN_DOWNSTREAM_CONTINUATION_SCENARIO.id]
        : []),
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
