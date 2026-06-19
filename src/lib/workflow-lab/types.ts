import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'

export interface WorkflowLabEpisodeSummary {
  readonly id: string
  readonly name: string
  readonly episodeNumber: number
  readonly workflowStage: EditFirstWorkflowStage
  readonly blockingKind: string
  readonly blockingReason: string | null
  readonly nextOperationId: string | null
  readonly allowedOperationIds: readonly string[]
}

export interface WorkflowLabForkResult {
  readonly sourceEpisode: WorkflowLabEpisodeSummary
  readonly forkedEpisode: WorkflowLabEpisodeSummary
}
