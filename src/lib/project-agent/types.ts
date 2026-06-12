import type { UIMessage } from 'ai'
import type {
  ProjectContextEditScreenplaySnapshot,
  ProjectContextEditScriptSnapshot,
  ProjectContextSnapshot,
} from '@/lib/project-context/types'
import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import type { ProjectPhase, ProjectPhaseSnapshot } from './project-phase'
import type { PlanValidationIssue } from '@/lib/agent-skills/types'
import type { AssistantPermissionMode } from './permission-mode'

export type UnknownObject = { [key: string]: unknown }

export type ProjectAssistantId = 'workspace-command'

export interface ProjectAgentContext {
  locale?: string
  episodeId?: string | null
  runId?: string | null
  selectedScopeRef?: string | null
  selectedPanelId?: string | null
  selectedClipId?: string | null
  selectedAssetId?: string | null
}

export interface ProjectAgentRunPartData {
  runId: string
  requestId: string
  status: 'running' | 'awaiting_approval' | 'awaiting_choice' | 'awaiting_task' | 'completed' | 'failed' | 'cancelled'
  controlKind: 'user_turn' | 'approval_response' | 'choice_response' | 'task_follow_up'
  stopReason?: string | null
}

export interface ProjectContextPartData {
  context: ProjectAssistantContextSnapshot
}

export interface ProjectPhasePartData {
  phase: ProjectPhase
  snapshot: ProjectPhaseSnapshot
}

export type ProjectAgentStopPartData =
  | {
    reason: 'awaiting_external_task'
    stepCount: number
    operationIds: string[]
    taskIds: string[]
    phases: string[]
  }
  | {
    reason: 'awaiting_user_confirmation'
    stepCount: number
    operationIds: string[]
  }
  | {
    reason: 'tool_error'
    stepCount: number
    operationIds: string[]
    codes: string[]
  }

export interface ProjectAgentInterruptionPartData {
  runId: string
  requestId: string
  interruptionId: string
  approvalId: string
  operationId: string
  toolCallId?: string | null
  display: {
    title: string
    description: string
  }
}

export type ProjectAgentInterruptionOutcome = 'approved' | 'rejected' | 'superseded'

export interface ProjectAgentInterruptionResolvedPartData {
  runId?: string | null
  interruptionId: string
  approvalId: string
  outcome: ProjectAgentInterruptionOutcome
}

export interface ProjectAgentChoiceResolvedPartData {
  runId?: string | null
  interruptionId?: string | null
  choiceType: 'duration_and_aspect_ratio' | 'screenplay_review' | 'style'
  toolCallId?: string | null
  cardId?: string | null
}

export interface AgentPlanPartData {
  draftPlanId: string
  goal: string
  summary: string
  requiresApproval: boolean
  validation: {
    ok: boolean
    issues: PlanValidationIssue[]
  }
  steps: Array<{
    stepKey: string
    skillId: string
    reason: string
    operationId: string
    inputArtifacts: string[]
    outputArtifacts: string[]
    dependsOn: string[]
    requiresApproval: boolean
  }>
}

export interface AgentDebugPartData {
  requestId: string
  toolsetSource: string
  coreOperationIds: string[]
  workflowOperationIds: string[]
  operationIds: string[]
}

export interface AgentRuntimeContextPartData {
  runtime: 'openai-agents-sdk'
  requestId: string
  modelKey: string
  locale: string
  assistantPermissionMode: AssistantPermissionMode
  projectId: string
  episodeId?: string | null
  messageCounts: {
    normalized: number
    runtime: number
    model: number
  }
  contextTokenEstimate: number | null
  toolset: {
    source: string
    coreOperationIds: string[]
    workflowOperationIds: string[]
    initialEnabledOperationIds: string[]
    continuationOperationId: string | null
    resumeOperationId: string | null
    includeChoiceOperation: boolean
  }
  editFirstWorkflow: EditFirstWorkflowState
  selectedTools: Array<{
    operationId: string
    description: string
  }>
}

export type ProjectAgentChoiceCardSubmit =
  | {
    kind: 'submit_tool_output'
  }
  | {
    kind: 'set_project_video_ratio'
    projectId: string
  }
  | {
    kind: 'confirm_edit_style_preview'
    projectId: string
    episodeId: string
    aspectRatio?: '9:16' | '16:9' | '21:9'
  }

export type ProjectAgentChoiceCardVariant = 'choice' | 'confirm_or_reply'

export interface ProjectAgentChoiceCardOption {
  value: string
  label: string
  description?: string | null
  imageUrl?: string | null
  meta?: string | null
}

export interface ProjectAgentChoiceCardGroup {
  key: string
  label: string
  required: boolean
  options: ProjectAgentChoiceCardOption[]
}

export interface ProjectAgentChoiceCardPartData {
  cardId: string
  runId?: string | null
  interruptionId?: string | null
  toolCallId: string
  choiceType: 'duration_and_aspect_ratio' | 'screenplay_review' | 'style'
  variant?: ProjectAgentChoiceCardVariant
  title: string
  description?: string | null
  groups: ProjectAgentChoiceCardGroup[]
  submitLabel: string
  submit: ProjectAgentChoiceCardSubmit
  replyLabel?: string | null
  replyPlaceholder?: string | null
  replySubmitLabel?: string | null
  replyToolOutputKey?: string | null
}

export interface TaskSubmittedPartData {
  operationId: string
  taskId: string
  status: string
  runId?: string | null
  deduped?: boolean
  mutationBatchId?: string | null
  projectId?: string
  episodeId?: string | null
  taskType?: string
  targetType?: string
  targetId?: string
}

export interface TaskBatchSubmittedPartData {
  operationId: string
  total: number
  taskIds: string[]
  results?: Array<{
    refId: string
    taskId: string
  }>
  mutationBatchId?: string | null
}

export interface EditStylePreviewGenerationPartData {
  operationId: 'generate_edit_style_previews'
  agentRunId?: string | null
  projectId: string
  episodeId: string
  screenplayId: string
  items: Array<{
    id: string
    styleKey: 'style_a' | 'style_b' | 'style_c'
    title: string
    summary: string
    taskId: string
    aspectRatio?: '9:16' | '16:9' | '21:9'
  }>
}

export interface ProjectAssistantContextSnapshot {
  projectId: string
  projectName: string
  episodeId?: string | null
  episodeName?: string | null
  selectedScopeRef?: string | null
  selectedPanelId?: string | null
  selectedClipId?: string | null
  selectedAssetId?: string | null
  activePlanRuns: ProjectContextSnapshot['activePlanRuns']
  activeOperationTasks: ProjectContextSnapshot['activeOperationTasks']
  recentOperationResults: ProjectContextSnapshot['recentOperationResults']
  latestArtifacts: ProjectContextSnapshot['latestArtifacts']
  editScreenplay?: ProjectContextEditScreenplaySnapshot | null
  editScript?: ProjectContextEditScriptSnapshot | null
  editFirstWorkflow: EditFirstWorkflowState
  config: {
    analysisModel?: string | null
    videoRatio: string
  }
}

export interface ProjectAssistantThreadSnapshot {
  id: string
  assistantId: ProjectAssistantId
  projectId: string
  episodeId?: string | null
  scopeRef: string
  messages: UIMessage[]
  createdAt: string
  updatedAt: string
}

export type WorkspaceAssistantPartType =
  | 'data-agent-debug'
  | 'data-agent-run'
  | 'data-agent-interruption'
  | 'data-agent-interruption-resolved'
  | 'data-agent-runtime-context'
  | 'data-agent-stop'
  | 'data-assistant-choice-card'
  | 'data-assistant-choice-resolved'
  | 'data-edit-style-preview-generation'
  | 'data-project-phase'
  | 'data-task-submitted'
  | 'data-task-batch-submitted'
  | 'data-plan'
  | 'data-project-context'
