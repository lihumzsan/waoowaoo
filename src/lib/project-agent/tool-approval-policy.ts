import type { ProjectAgentOperationDefinition } from '@/lib/operations/types'

export function shouldRequireInteractiveToolApproval(params: {
  operation: ProjectAgentOperationDefinition
  billingConfirmationRequired: boolean
}): boolean {
  if (params.operation.agentFlow?.suspendsFor === 'choice') return false
  if (params.operation.confirmation.kind === 'billable_media') {
    return params.billingConfirmationRequired
  }
  return params.operation.confirmation.kind === 'destructive'
}
