import type { UIMessage } from 'ai'
import type {
  ProjectContextStoryCanonSnapshot,
  ProjectContextEditChapterSnapshot,
  ProjectContextSnapshot,
} from '@/lib/project-context/types'
import type { ProjectAgentChoiceDecision } from './choice-result'
import type {
  ProjectAgentChoiceCardPartData,
} from './choice-offer'
import type { BillingReceiptView } from '@/lib/billing/task-billing-view'
import type { OperationPlanView } from '@/lib/operations/planning'
import type { PlannedOperationInvocation } from '@/lib/operations/planned-operation-invocation'
import type {
  ProjectAgentRunControlKind,
  ProjectAgentRunStatus,
} from './runs'
import type {
  ProjectAgentActivityStatus,
  ProjectAgentActivityType,
} from './event'
import type { ProjectAgentRunFence } from './run-fence'
import type { ProjectAgentSubagentEventPartData } from './subagent-events'
import type { CreativeResourceLinkView } from '@/lib/creative-resource/contracts'

export type UnknownObject = { [key: string]: unknown }

export type ProjectAssistantId = 'workspace-command'

export interface ProjectAgentContext {
  locale?: string
  episodeId?: string | null
  runId?: string | null
  runFence?: ProjectAgentRunFence | null
  /** Immutable identity of the current model/tool execution segment. */
  executionSegmentId?: string | null
  /** Exact visible text from the user message that started this user-turn segment. */
  userTurnText?: string | null
  /** Server-resolved Resource identities attached to this exact user turn. */
  userTurnMediaResourceIds?: readonly string[]
  choiceDecision?: ProjectAgentChoiceDecision | null
  selectedScopeRef?: string | null
  selectedAssetId?: string | null
  /** Exact approved invocation keyed by the SDK tool-call identity. */
  approvedInvocationByToolCallId?: Record<string, PlannedOperationInvocation>
}

export interface ProjectAgentRunPartData {
  runId: string
  requestId: string
  status: ProjectAgentRunStatus
  controlKind: ProjectAgentRunControlKind
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
  type: ProjectAgentActivityType
  status: ProjectAgentActivityStatus
  operationId?: string | null
  sourceOperationId?: string | null
  toolCallId?: string | null
}

export type ProjectAgentSubagentPartData = ProjectAgentSubagentEventPartData

export interface ProjectContextPartData {
  context: ProjectAssistantContextSnapshot
}

/**
 * Live view of one Primary web_search call. `phase` and `query` are presentation
 * only; the authoritative result is still the Operation output. Every url here
 * is untrusted third-party data and must be rendered as an external link, never
 * as project material.
 */
export interface ProjectAgentWebSearchPartData {
  toolCallId: string | null
  phase: 'searching' | 'completed'
  brief: string
  activeQuery: string | null
  queries: readonly string[]
  sources: readonly { title: string; url: string }[]
  images: readonly {
    imageUrl: string
    thumbnailUrl: string | null
    sourceUrl: string | null
    caption: string | null
  }[]
}

export type ProjectAgentStopPartData =
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
  inputHash: string
  display: {
    title: string
    description: string
  }
  operationPlan?: OperationPlanView | null
}

export interface ProjectAgentOperationPlanPreviewPartData {
  operationId: string
  toolCallId?: string | null
  operationPlan: OperationPlanView
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
  toolCallId?: string | null
  cardId?: string | null
}

export interface AgentDebugPartData {
  requestId: string
  toolsetSource: string
  operationIds: string[]
}

export interface AgentRuntimeContextPartData {
  runtime: 'openai-agents-sdk'
  requestId: string
  modelKey: string
  locale: string
  billingConfirmationRequired: boolean
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
    operationIds: string[]
    directOperationIds: string[]
    onDemandOperationIds: string[]
    disabledOperationIds: string[]
  }
  selectedTools: Array<{
    operationId: string
    description: string
  }>
}

export type {
  ProjectAgentChoiceCardDefinition,
  ProjectAgentChoiceCardPartData,
} from './choice-offer'
export type ProjectAgentChoiceCardGroup = ProjectAgentChoiceCardPartData['groups'][number]
export type ProjectAgentChoiceCardOption = ProjectAgentChoiceCardGroup['options'][number]

export interface TaskSubmittedPartData {
  operationId: string
  taskId: string
  status: string
  runId?: string | null
  deduped?: boolean
  billingReceipt?: BillingReceiptView | null
  projectId?: string
  episodeId?: string | null
  chapterId?: string | null
  taskType?: string
  targetType?: string
  targetId?: string
  sourceKind?: string | null
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
}

export interface ProjectAssistantContextSnapshot {
  projectId: string
  projectName: string
  episodeId?: string | null
  episodeName?: string | null
  selectedScopeRef?: string | null
  selectedAssetId?: string | null
  activeOperationTasks: ProjectContextSnapshot['activeOperationTasks']
  recentOperationResults: ProjectContextSnapshot['recentOperationResults']
  storyCanon?: ProjectContextStoryCanonSnapshot | null
  chapters?: ProjectContextEditChapterSnapshot[]
  config: {
    videoRatio: string | null
  }
}

/**
 * Surfaces a lossy context operation to the user.
 *
 * Shedding recoverable tool results is deliberately silent — the model can
 * re-read them, so a notice would be noise. Summarising conversation is not
 * recoverable, so it must be visible: otherwise a later gap in the assistant's
 * memory reads as the model being careless rather than as a known trade-off,
 * and the user has no way to tell which part was condensed.
 */
export interface ProjectAgentContextCompactedPartData {
  runId: string
  summarizedItemCount: number
  summaryText: string
}

export interface ProjectAgentResourceLinksPartData {
  resources: readonly CreativeResourceLinkView[]
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
  | 'data-agent-operation-plan-preview'
  | 'data-agent-activity'
  | 'data-agent-subagent-event'
  | 'data-agent-stop'
  | 'data-assistant-context-compacted'
  | 'data-assistant-choice-card'
  | 'data-assistant-choice-resolved'
  | 'data-assistant-resource-links'
  | 'data-task-submitted'
  | 'data-task-batch-submitted'
  | 'data-project-context'
  | 'data-web-search'
