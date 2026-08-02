import type { UIMessage } from 'ai'
import type {
  ProjectContextStoryCanonSnapshot,
  ProjectContextEditChapterSnapshot,
  ProjectContextSnapshot,
} from '@/lib/project-context/types'
import type { ProjectAgentChoiceDecision } from './choice-result'
import type { ProjectAgentChoiceCardDefinition } from './choice-offer'
import type { BillingReceiptView } from '@/lib/billing/task-billing-view'
import type { PlannedOperationInvocation } from '@/lib/operations/planned-operation-invocation'
import type { CreativeResourceLinkView } from '@/lib/creative-resource/contracts'

export type UnknownObject = { [key: string]: unknown }

export type ProjectAssistantId = 'workspace-command'

export interface ProjectAgentContext {
  locale?: string
  episodeId?: string | null
  /** Canonical B+ model execution identity. */
  turnId?: string | null
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

export type { ProjectAgentChoiceCardDefinition } from './choice-offer'
export type ProjectAgentChoiceCardGroup = ProjectAgentChoiceCardDefinition['groups'][number]
export type ProjectAgentChoiceCardOption = ProjectAgentChoiceCardGroup['options'][number]

export interface TaskSubmittedPartData {
  operationId: string
  taskId: string
  status: string
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

export interface ProjectAgentResourceLinksPartData {
  resources: readonly CreativeResourceLinkView[]
}

export interface ProjectAgentContextCompactedPartData {
  replacedItemCount: number
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
  | 'data-assistant-context-compacted'
  | 'data-assistant-resource-links'
  | 'data-task-batch-submitted'
  | 'data-project-context'
  | 'data-web-search'
