import type { WorkspaceCanvasNodeData } from '../node-canvas-types'

export type WorkspaceCanvasStreamKind =
  | 'editBible'
  | 'editScript'
  | 'editShotExecutionPlan'
  | 'bgmScore'

export type WorkspaceCanvasStreamPatchData = Partial<Pick<
  WorkspaceCanvasNodeData,
  | 'body'
  | 'meta'
  | 'artifactPhase'
  | 'statusLabel'
  | 'isRunning'
  | 'streamPresentation'
  | 'editBibleDetails'
  | 'editScriptDetails'
  | 'editPipelineStepDetails'
  | 'bgmScoreDetails'
>>

export interface WorkspaceCanvasStreamPatch {
  readonly nodeId: string
  readonly streamKind: WorkspaceCanvasStreamKind
  readonly taskId: string
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
