import type { ArtifactType } from '@/lib/artifact-system/types'
import type { ProjectPolicyOverrideInput } from '@/lib/project-context/types'

export type CommandSource = 'gui' | 'assistant-panel'
export type CommandType = 'run_operation'
export type CommandStatus =
  | 'planned'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'running'
  | 'completed'
  | 'failed'
  | 'canceled'

export interface CommandEnvelopeBase {
  source: CommandSource
  projectId: string
  episodeId?: string | null
  scopeRef?: string | null
  policyOverrides?: ProjectPolicyOverrideInput | null
}

export type CommandOperationId =
  | 'insert_panel'
  | 'panel_variant'
  | 'modify_shot_prompt'

export type OperationRiskLevel = 'low' | 'medium' | 'high'
export type OperationMutationKind = 'read' | 'generate' | 'update' | 'delete'

export interface CommandOperationDefinition {
  id: CommandOperationId
  name: string
  summary: string
  riskLevel: OperationRiskLevel
  requiresApproval: boolean
  inputArtifacts: ArtifactType[]
  outputArtifacts: ArtifactType[]
  invalidates: ArtifactType[]
  mutationKind: OperationMutationKind
}

export interface RunOperationCommand extends CommandEnvelopeBase {
  commandType: 'run_operation'
  operationId: CommandOperationId
  input: Record<string, unknown>
}

export type CommandEnvelope = RunOperationCommand

export interface PlanStep {
  stepKey: string
  operationId: string
  title: string
  orderIndex: number
  scopeRef?: string | null
  inputArtifacts: ArtifactType[]
  outputArtifacts: ArtifactType[]
  invalidates: ArtifactType[]
  mutationKind: OperationMutationKind
  riskLevel: OperationRiskLevel
  requiresApproval: boolean
  dependsOn: string[]
}

export interface ExecutionPlanDraft {
  summary: string
  requiresApproval: boolean
  riskSummary: {
    highestRiskLevel: 'low' | 'medium' | 'high'
    reasons: string[]
  }
  steps: PlanStep[]
}

export interface CommandExecutionResult {
  commandId: string
  planId: string
  requiresApproval: boolean
  status: CommandStatus
  linkedTaskId?: string | null
  summary: string
  steps: PlanStep[]
}

export interface CommandListItem extends CommandExecutionResult {
  createdAt: string
  updatedAt: string
  commandType: CommandType
  source: CommandSource
  episodeId?: string | null
  approval?: {
    id: string
    status: 'pending' | 'approved' | 'rejected'
    reason?: string | null
    responseNote?: string | null
  } | null
}
