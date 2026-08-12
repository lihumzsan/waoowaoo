import { getTaskDefinition } from '@/lib/task/definition'
import { resolveWorkspaceResourceRefs } from '@/lib/workspace-resource/resource-impact'
import type { OperationPlan } from './plan-contract'

export function assertOperationPlanTaskResourceScopes(plan: OperationPlan): void {
  for (const task of plan.tasks) {
    resolveWorkspaceResourceRefs({
      impact: getTaskDefinition(task.taskType).terminalResourceImpact,
      projectId: plan.projectId,
    })
  }
}
