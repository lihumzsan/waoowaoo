import type { TaskRuntimeTarget } from '@/lib/task/runtime-targets'

export interface WorkspaceAssistantActiveTaskTarget extends TaskRuntimeTarget {
  readonly taskId: string
  readonly operationId?: string | null
  readonly sourceKind?: string | null
}

export interface WorkspaceAssistantActiveFocusRequest {
  readonly operationId: string
  readonly requestKey: string
  readonly taskTargets?: readonly WorkspaceAssistantActiveTaskTarget[]
}
