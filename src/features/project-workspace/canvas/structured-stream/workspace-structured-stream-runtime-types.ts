import type { WorkspaceCanvasNodeData } from '../node-canvas-types'
import type { WorkspaceCanvasStructuredStreamKind } from '@/lib/structured-stream/workspace-structured-stream-adapters'

export type WorkspaceCanvasStreamKind = WorkspaceCanvasStructuredStreamKind

export interface WorkspaceStructuredStreamHandoffIdentity {
  readonly taskId: string
  readonly targetType: string | null
  readonly targetId: string | null
}

export type WorkspaceCanvasStreamPatchData = Partial<Pick<
  WorkspaceCanvasNodeData,
  | 'body'
  | 'meta'
  | 'sourceScriptDetails'
  | 'editBibleDetails'
  | 'editScriptDetails'
  | 'editPipelineStepDetails'
  | 'bgmScoreDetails'
>>

export interface WorkspaceCanvasStreamPatch {
  readonly nodeId: string
  readonly streamKind: WorkspaceCanvasStreamKind
  readonly taskId: string
  readonly taskType: string | null
  readonly terminalHandoff?: boolean
  readonly presentation: NonNullable<WorkspaceCanvasNodeData['lifecycle']['stream']>
  readonly data: WorkspaceCanvasStreamPatchData
}

export interface WorkspaceCanvasStreamTarget {
  readonly nodeId: string
  readonly streamKind: WorkspaceCanvasStreamKind
  readonly taskId: string
  readonly taskType: string | null
  readonly targetType: string | null
  readonly targetId: string
  readonly episodeId: string | null
}
