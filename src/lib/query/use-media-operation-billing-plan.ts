'use client'

import {
  fetchOperationPlanView,
  readPlanConfirmedMaxCost,
} from './operation-plan-client'

export function useMediaOperationBillingPlan(projectId: string | null, episodeId?: string | null) {
  return async (operationId: string, input: Record<string, unknown>) => {
    if (!projectId) throw new Error('PROJECT_ID_REQUIRED')
    const plan = await fetchOperationPlanView({
      projectId,
      operationId,
      input,
      context: episodeId ? { episodeId } : undefined,
    })
    return readPlanConfirmedMaxCost(plan)
  }
}
