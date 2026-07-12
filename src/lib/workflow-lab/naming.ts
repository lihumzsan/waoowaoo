import { PROJECT_NAME_MAX_LENGTH } from '@/lib/projects/validation'

const WORKFLOW_LAB_NAME_PREFIX = '[LAB]'

export function buildWorkflowLabProjectName(params: {
  readonly sourceName: string
  readonly stage: string
  readonly now?: Date
}): string {
  const timestamp = (params.now ?? new Date()).toISOString().replace('T', ' ').slice(0, 19)
  const prefix = `${WORKFLOW_LAB_NAME_PREFIX} ${params.stage} - `
  const suffix = ` - ${timestamp}`
  const sourceBudget = PROJECT_NAME_MAX_LENGTH - prefix.length - suffix.length
  if (sourceBudget < 1) throw new Error(`WORKFLOW_LAB_STAGE_NAME_TOO_LONG:${params.stage}`)
  const sourceName = params.sourceName.trim().slice(0, sourceBudget).trimEnd()
  if (!sourceName) throw new Error('WORKFLOW_LAB_SOURCE_PROJECT_NAME_REQUIRED')
  return `${prefix}${sourceName}${suffix}`
}
