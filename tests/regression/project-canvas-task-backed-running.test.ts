import { describe, expect, it } from 'vitest'
import type { WorkspaceCanvasFlowNode } from '@/features/project-workspace/canvas/node-canvas-types'
import { resolveWorkspaceCanvasNodeData } from '@/features/project-workspace/canvas/workspace-node-runtime'
import { taskRuntimeTargetQueryKey, type TaskRuntimeStateLike } from '@/lib/task/runtime-targets'

const runtimeTarget = {
  targetType: 'CharacterAppearance',
  targetId: 'appearance-1',
  types: ['image_character'],
} as const

const pendingLifecycle = {
  phase: 'pending',
  taskId: null,
  taskType: null,
  progress: null,
  error: null,
  stream: null,
} as const

function node(): WorkspaceCanvasFlowNode {
  return {
    id: 'edit-asset-group:script-1',
    type: 'workspaceNode',
    position: { x: 0, y: 0 },
    data: {
      kind: 'editAssetGroup',
      mediaLoadingContext: { styleImageUrl: 'https://cdn.example/style.png' },
      layoutNodeType: 'editAssetGroup',
      targetType: 'editAssetRequirement',
      targetId: 'script-1',
      title: 'Assets',
      eyebrow: 'Assets',
      body: 'Alice',
      meta: '',
      lifecycle: pendingLifecycle,
      runtimeTargets: [runtimeTarget],
      width: 720,
      height: 420,
      editAssetGroupDetails: {
        editScriptId: 'script-1',
        assets: [{
          requirementId: 'requirement-1',
          kind: 'character',
          name: 'Alice',
          eyebrow: 'character',
          description: 'Alice',
          shotIds: ['shot-1'],
          shotNumbers: [1],
          lifecycle: pendingLifecycle,
          runtimeTarget,
        }],
      },
    },
  }
}

describe('project canvas task-backed running invariant', () => {
  it('does not display an artifact as running when no real task exists', () => {
    const resolved = resolveWorkspaceCanvasNodeData({
      node: node(),
      statesByQueryKey: new Map(),
      streamPatch: null,
      submitting: false,
    })

    expect(resolved.lifecycle.phase).toBe('pending')
    expect(resolved.editAssetGroupDetails?.assets[0]?.lifecycle.phase).toBe('pending')
  })

  it('requires a real taskId in addition to queued or processing phase', () => {
    const withoutTaskId: TaskRuntimeStateLike = { phase: 'queued', runningTaskId: null }
    const unresolved = resolveWorkspaceCanvasNodeData({
      node: node(),
      statesByQueryKey: new Map([[taskRuntimeTargetQueryKey(runtimeTarget), withoutTaskId]]),
      streamPatch: null,
      submitting: false,
    })
    expect(unresolved.lifecycle.phase).toBe('pending')

    const withTaskId: TaskRuntimeStateLike = {
      phase: 'queued',
      taskId: 'task-image-1',
      runningTaskId: 'task-image-1',
      runningTaskType: 'image_character',
    }
    const resolved = resolveWorkspaceCanvasNodeData({
      node: node(),
      statesByQueryKey: new Map([[taskRuntimeTargetQueryKey(runtimeTarget), withTaskId]]),
      streamPatch: null,
      submitting: false,
    })
    expect(resolved.lifecycle).toMatchObject({
      phase: 'queued',
      taskId: 'task-image-1',
      taskType: 'image_character',
    })
    expect(resolved.editAssetGroupDetails?.assets[0]?.lifecycle.phase).toBe('queued')
  })
})
