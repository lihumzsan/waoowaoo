import type { PlannedOperationInvocation } from '@/lib/operations/planned-operation-invocation'
import type { AssistantRuntimeSelectedResourceReference } from '@/lib/assistant-runtime/contracts'

export type ProjectAssistantId = 'workspace-command'

/** Trusted product context attached to an Operation invocation. */
export interface ProjectAgentContext {
  locale?: string
  turnId?: string | null
  userTurnText?: string | null
  userTurnMediaResourceIds?: readonly string[]
  selectedScopeRef?: string | null
  selectedAssetId?: string | null
  selectedResource?: AssistantRuntimeSelectedResourceReference | null
  approvedInvocationByToolCallId?: Record<string, PlannedOperationInvocation>
}

export interface ProjectAgentContextCompactionPartData {
  status: 'running' | 'completed' | 'failed'
  replacedItemCount: number
}

export type WorkspaceAssistantPartType =
  | 'data-assistant-context-compacted'
  | 'data-assistant-runtime-goal'
  | 'data-assistant-runtime-progress'
