import type { GoldenScenarioContract } from './types'
export {
  GOLDEN_EDIT_FIRST_WORKFLOW_STATUSES,
  GOLDEN_EDIT_FIRST_WORKFLOW_STEPS,
} from './stages'

export const GOLDEN_SCENARIO_CONTRACTS = [
  {
    id: 'GJ-MAIN-STORY-TO-FINAL-DELIVERABLE',
    kind: 'mainline',
    title: 'an empty project generates one Canvas video, skips it in the remaining batch, and reaches one durable final video',
    startStep: 'unavailable',
    expectedTerminal: { step: 'final_render', status: 'completed' },
    requiresWorkers: true,
    zeroPaidProviderCalls: true,
  },
  {
    id: 'GJ-FREEFORM-RESOURCE-CREATION',
    kind: 'freeform',
    title: 'natural language directly creates, partially retries, reuses, adopts, and renders persistent Resources',
    startStep: 'unavailable',
    expectedTerminal: 'independent_resources_ready',
    requiresWorkers: true,
    zeroPaidProviderCalls: true,
  },
  {
    id: 'GJ-FREEFORM-ZERO-VIDEO',
    kind: 'freeform',
    title: 'an empty project submits text-to-video without creating workflow artifacts',
    startStep: 'unavailable',
    expectedTerminal: 'independent_video_ready',
    requiresWorkers: true,
    zeroPaidProviderCalls: true,
  },
  {
    id: 'GJ-AUTH-UNAUTHENTICATED-DENIAL',
    kind: 'security',
    title: 'an unauthenticated browser cannot open a workspace or read project data',
    startStep: 'outside_workflow',
    expectedTerminal: 'unauthenticated_workspace_access_denied',
    requiresWorkers: false,
    zeroPaidProviderCalls: true,
  },
  {
    id: 'GJ-PROJECT-CROSS-USER-ISOLATION',
    kind: 'security',
    title: 'a second user cannot read or mutate the owner project',
    startStep: 'outside_workflow',
    expectedTerminal: 'cross_user_project_access_denied',
    requiresWorkers: false,
    zeroPaidProviderCalls: true,
  },
  {
    id: 'GJ-ASSET-HUB-CROSS-PROJECT-DENIAL',
    kind: 'security',
    title: 'one project cannot overwrite an asset owned by another project',
    startStep: 'outside_workflow',
    expectedTerminal: 'cross_project_asset_mutation_denied',
    requiresWorkers: false,
    zeroPaidProviderCalls: true,
  },
] as const satisfies readonly GoldenScenarioContract[]

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
}
