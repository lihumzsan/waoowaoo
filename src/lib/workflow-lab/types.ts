import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'
import type { EditFirstChoiceType } from '@/lib/project-agent/choice-card'

export type WorkflowLabCheckpointKind = 'choice' | 'approval'

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

export interface WorkflowLabCheckpointSummary {
  readonly id: string
  readonly sourceEpisodeId: string
  readonly kind: WorkflowLabCheckpointKind
  readonly workflowStage: EditFirstWorkflowStage
  readonly title: string
  readonly detail: string | null
  readonly choiceType: EditFirstChoiceType | null
  readonly operationId: string | null
  readonly messageIndex: number
  readonly partIndex: number
  readonly assistantMessageCount: number
}

export interface WorkflowLabCheckpointListResult {
  readonly sourceEpisode: WorkflowLabEpisodeSummary
  readonly checkpoints: readonly WorkflowLabCheckpointSummary[]
}

export interface WorkflowLabProjectSummary {
  readonly id: string
  readonly name: string
}

export interface WorkflowLabForkResult {
  readonly checkpoint: WorkflowLabCheckpointSummary
  readonly sourceProject: WorkflowLabProjectSummary
  readonly sourceEpisode: WorkflowLabEpisodeSummary
  readonly labProject: WorkflowLabProjectSummary
  readonly labEpisode: WorkflowLabEpisodeSummary
}
