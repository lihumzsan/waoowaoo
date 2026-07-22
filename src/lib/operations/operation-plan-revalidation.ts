import type { ProjectAgentOperationContext, ProjectAgentOperationDefinition } from './types'
import {
  hashOperationPlanArtifacts,
  type OperationPlanArtifactHashes,
} from './operation-plan-snapshot'
import { quoteOperationPlan } from './planning'
import { freezeProjectVideoRatioIntoPlan } from './project-video-ratio-policy'

export type OperationPlanArtifactKey = keyof OperationPlanArtifactHashes

export function changedOperationPlanArtifacts(
  snapshot: OperationPlanArtifactHashes,
  current: OperationPlanArtifactHashes,
): OperationPlanArtifactKey[] {
  return (['inputHash', 'planHash', 'quoteHash'] as const).filter((key) => snapshot[key] !== current[key])
}

export async function buildCurrentOperationPlanArtifactHashes<Input>(params: {
  operation: ProjectAgentOperationDefinition<Input, unknown>
  ctx: ProjectAgentOperationContext
  normalizedInput: Input
}): Promise<OperationPlanArtifactHashes> {
  if (!params.operation.plan) {
    throw new Error(`BILLABLE_OPERATION_PLAN_MISSING:${params.operation.id}`)
  }
  const rawCurrentPlan = await params.operation.plan({
    ...params.ctx,
    writer: null,
    executionAuthorization: null,
  }, params.normalizedInput)
  const currentPlan = await freezeProjectVideoRatioIntoPlan(rawCurrentPlan)
  const currentQuote = await quoteOperationPlan(currentPlan)
  return hashOperationPlanArtifacts({
    normalizedInput: params.normalizedInput,
    plan: currentPlan,
    quote: currentQuote,
  })
}
