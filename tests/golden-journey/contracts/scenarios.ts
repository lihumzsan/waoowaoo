import type { GoldenScenarioContract } from './types'

export const GOLDEN_SCENARIO_CONTRACTS = [
  {
    id: 'GJ-FREEFORM-RESOURCE-CREATION',
    kind: 'freeform',
    title: 'natural language composes independent Resources with schema-projected card summaries, refresh-safe current Choice commitments, and explicitly adopted Chapters that become parallel Worker inputs',
    startState: 'empty_project',
    expectedTerminal: 'independent_resources_and_explicit_optional_projections_ready',
    requiresWorkers: true,
    zeroPaidProviderCalls: true,
  },
  {
    id: 'GJ-PARALLEL-OPERATION-BATCH',
    kind: 'freeform',
    title: 'the model resolves a missing ratio with one current Choice, then one step requests three independent images under one exact quote and background batch',
    startState: 'empty_project',
    expectedTerminal: 'parallel_resources_ready',
    requiresWorkers: true,
    zeroPaidProviderCalls: true,
  },
  {
    id: 'GJ-FREEFORM-ZERO-VIDEO',
    kind: 'freeform',
    title: 'the model resolves a missing ratio with one current Choice, then an empty project submits text-to-video without workflow artifacts',
    startState: 'empty_project',
    expectedTerminal: 'independent_video_ready',
    requiresWorkers: true,
    zeroPaidProviderCalls: true,
  },
  {
    id: 'GJ-ASSISTANT-STOP-REPLY',
    kind: 'freeform',
    title: 'the composer stop control cancels one streamed foreground Run and permits the next user turn',
    startState: 'empty_project',
    expectedTerminal: 'cancelled_reply_then_new_turn_completed',
    requiresWorkers: false,
    zeroPaidProviderCalls: true,
  },
  {
    id: 'GJ-AUTH-UNAUTHENTICATED-DENIAL',
    kind: 'security',
    title: 'an unauthenticated browser cannot open a workspace or read project data',
    startState: 'outside_workspace',
    expectedTerminal: 'unauthenticated_workspace_access_denied',
    requiresWorkers: false,
    zeroPaidProviderCalls: true,
  },
  {
    id: 'GJ-PROJECT-CROSS-USER-ISOLATION',
    kind: 'security',
    title: 'a second user cannot read or mutate the owner project',
    startState: 'outside_workspace',
    expectedTerminal: 'cross_user_project_access_denied',
    requiresWorkers: false,
    zeroPaidProviderCalls: true,
  },
  {
    id: 'GJ-ASSET-HUB-CROSS-PROJECT-DENIAL',
    kind: 'security',
    title: 'one project cannot overwrite an asset owned by another project',
    startState: 'outside_workspace',
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
