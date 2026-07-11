import type { ProjectAgentOperationContext } from '@/lib/operations/types'

export type ReplayEvent = {
  id: string
  type: string
  mutationBatchId?: string
  taskId?: string
  taskType?: string | null
  targetType?: string | null
  targetId?: string | null
  projectId: string
  userId: string
  ts: string
  operationId?: string | null
  episodeId: string | null
  targets?: Array<{ targetType: string; targetId: string }>
  payload?: Record<string, unknown> | null
  assistantId?: string
  scopeRef?: string
  agentEventId?: string
}

export type TaskSnapshotRow = {
  id: string
  type: string
  targetType: string
  targetId: string
  episodeId: string | null
  userId: string
  status: string
  progress: number
  payload: Record<string, unknown> | null
  updatedAt: Date
}

export function buildSseOperationContext(): ProjectAgentOperationContext {
  return {
    request: new Request('http://localhost') as ProjectAgentOperationContext['request'],
    userId: 'user-1',
    projectId: 'project-1',
    context: {},
    source: 'project-ui',
    writer: null,
  }
}
