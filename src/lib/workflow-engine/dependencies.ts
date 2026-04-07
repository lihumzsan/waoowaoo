import { resolveWorkflowRetryInvalidationStepKeys } from './registry'

export function resolveRetryInvalidationStepKeys(params: {
  workflowType: string
  stepKey: string
  existingStepKeys: string[]
}): string[] {
  return resolveWorkflowRetryInvalidationStepKeys(params)
}
