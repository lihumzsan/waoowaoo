import type { UIMessage } from 'ai'
import type {
  ProjectContextEditScreenplaySnapshot,
  ProjectContextEditScriptSnapshot,
  ProjectContextSnapshot,
} from '@/lib/project-context/types'
import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import type { ProjectPhase, ProjectPhaseSnapshot } from './project-phase'
import type { AssistantPermissionMode } from './permission-mode'
import type { BillingReceiptView } from '@/lib/billing/task-billing-view'
import type { OperationPlanView } from '@/lib/operations/planning'

export type UnknownObject = { [key: string]: unknown }

export type ProjectAssistantId = 'workspace-command'

export interface ProjectAgentContext {
  locale?: string
  episodeId?: string | null
  runId?: string | null
  currentActivityId?: string | null
  selectedScopeRef?: string | null
  selectedPanelId?: string | null
  selectedAssetId?: string | null
  confirmedMaxCostByOperationId?: Record<string, number>
}

export interface ProjectAgentRunPartData {
  runId: string
  requestId: string
  status: 'running' | 'awaiting_approval' | 'awaiting_choice' | 'awaiting_task' | 'completed' | 'failed' | 'cancelled'
  controlKind: 'user_turn' | 'approval_response' | 'choice_response' | 'task_follow_up'
  stopReason?: string | null
}

export interface ProjectAgentOperationStartPartData {
  runId?: string | null
  operationId: string
  toolCallId?: string | null
}

export interface ProjectAgentActivityPartData {
  activityId: string
  runId: string
  type: 'operation' | 'waiting_task' | 'task_follow_up' | 'awaiting_choice' | 'awaiting_approval'
  status: 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled'
  operationId?: string | null
  sourceOperationId?: string | null
  toolCallId?: string | null
  choiceType?: 'duration_and_aspect_ratio' | 'screenplay_review' | 'style' | 'asset_review' | null
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
  operationPlan?: OperationPlanView | null
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
  choiceType: 'duration_and_aspect_ratio' | 'screenplay_review' | 'style' | 'asset_review'
  toolCallId?: string | null
  cardId?: string | null
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

export type ProjectAgentChoiceCardVariant = 'choice' | 'confirm' | 'confirm_or_reply'

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
  choiceType: 'duration_and_aspect_ratio' | 'screenplay_review' | 'style' | 'asset_review'
  variant?: ProjectAgentChoiceCardVariant
  autoSubmitOnReady?: boolean
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
  billingReceipt?: BillingReceiptView | null
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
  taskTotal?: number
  targetTotal?: number
  taskIds: string[]
  results?: Array<{
    refId: string
    taskId: string
    taskType?: string
    targetType?: string
    targetId?: string
    billingReceipt?: BillingReceiptView | null
  }>
  billingReceipt?: BillingReceiptView | null
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
    styleKey: `style_${'a' | 'b' | 'c'}` | `style_${'a' | 'b' | 'c'}_${number}`
    title: string
    summary: string
    // 追加候选在「建行 → 派发任务 → 回填 taskId」之间存在窗口；taskId 缺失时仍需展示成生成中。
    taskId?: string
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
  | 'data-agent-operation-start'
  | 'data-agent-activity'
  | 'data-agent-stop'
  | 'data-assistant-choice-card'
  | 'data-assistant-choice-resolved'
  | 'data-edit-style-preview-generation'
  | 'data-project-phase'
  | 'data-task-submitted'
  | 'data-task-batch-submitted'
  | 'data-project-context'
