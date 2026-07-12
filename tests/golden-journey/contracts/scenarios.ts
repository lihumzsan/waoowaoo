import type { GoldenScenarioContract } from './types'
export { GOLDEN_EDIT_FIRST_WORKFLOW_STAGES } from './stages'

export const GOLDEN_SCENARIO_CONTRACTS = [
  {
    id: 'GJ-MAIN-STORY-TO-FINAL-DELIVERABLE',
    kind: 'mainline',
    title: 'an empty project reaches one durable final video through a real multi-chapter browser workflow',
    startStage: 'not_started',
    expectedTerminal: 'completed',
    requiresWorkers: true,
    zeroPaidProviderCalls: true,
  },
  {
    id: 'GJ-AUTH-UNAUTHENTICATED-DENIAL',
    kind: 'security',
    title: 'an unauthenticated browser cannot open a workspace or read project data',
    startStage: 'outside_workflow',
    expectedTerminal: 'unauthenticated_workspace_access_denied',
    requiresWorkers: false,
    zeroPaidProviderCalls: true,
  },
  {
    id: 'GJ-PROJECT-CROSS-USER-ISOLATION',
    kind: 'security',
    title: 'a second user cannot read or mutate the owner project',
    startStage: 'outside_workflow',
    expectedTerminal: 'cross_user_project_access_denied',
    requiresWorkers: false,
    zeroPaidProviderCalls: true,
  },
  {
    id: 'GJ-ASSET-HUB-CROSS-PROJECT-DENIAL',
    kind: 'security',
    title: 'one project cannot overwrite an asset owned by another project',
    startStage: 'outside_workflow',
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
