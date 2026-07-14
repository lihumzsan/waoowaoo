import type { WorkspaceCanvasNodeKind } from '../node-canvas-types'

export interface WorkspaceCanvasConformanceFixture<K extends WorkspaceCanvasNodeKind = WorkspaceCanvasNodeKind> {
  readonly kind: K
  readonly canonicalNodeId: string
  readonly taskTarget: {
    readonly targetType: string
    readonly targetId: string
    readonly taskType: string
  } | null
}

const fixture = <K extends WorkspaceCanvasNodeKind>(
  kind: K,
  taskTarget: WorkspaceCanvasConformanceFixture['taskTarget'],
): WorkspaceCanvasConformanceFixture<K> => ({
  kind,
  canonicalNodeId: `${kind}:conformance-resource`,
  taskTarget,
})

const taskTarget = {
  targetType: 'ConformanceTarget',
  targetId: 'conformance-resource',
  taskType: 'conformance_task',
} as const

export const WORKSPACE_CANVAS_CONFORMANCE_FIXTURES = {
  finalTimeline: fixture('finalTimeline', taskTarget),
  editSourceScript: fixture('editSourceScript', taskTarget),
  editBible: fixture('editBible', taskTarget),
  editStyleBible: fixture('editStyleBible', taskTarget),
  editPipelineStep: fixture('editPipelineStep', taskTarget),
  editProcessGroup: fixture('editProcessGroup', null),
  editScript: fixture('editScript', taskTarget),
  editShotExecutionPlan: fixture('editShotExecutionPlan', taskTarget),
  videoPlan: fixture('videoPlan', taskTarget),
  bgmScore: fixture('bgmScore', taskTarget),
  ambientSound: fixture('ambientSound', taskTarget),
  editRequiredAsset: fixture('editRequiredAsset', taskTarget),
  editAssetGroup: fixture('editAssetGroup', taskTarget),
} as const satisfies Record<WorkspaceCanvasNodeKind, WorkspaceCanvasConformanceFixture>
