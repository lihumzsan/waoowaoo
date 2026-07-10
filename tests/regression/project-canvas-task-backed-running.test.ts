import { describe, expect, it } from 'vitest'
import type { WorkspaceCanvasFlowNode } from '@/features/project-workspace/canvas/node-canvas-types'
import { resolveWorkspaceNodeRuntimePatch } from '@/features/project-workspace/canvas/workspace-node-runtime'
import { taskRuntimeTargetQueryKey, type TaskRuntimeStateLike } from '@/lib/task/runtime-targets'

const runtimeTarget = {
  targetType: 'CharacterAppearance',
  targetId: 'appearance-1',
  types: ['image_character'],
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
      artifactPhase: 'running',
      statusLabel: 'Generating',
      isRunning: true,
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
          statusLabel: 'Generating',
          isRunning: true,
          runtimeTarget,
          taskProgress: null,
        }],
      },
    },
  }
}

const labels = {
  running: 'Running',
  pending: 'Pending',
  failed: 'Failed',
}

describe('project canvas task-backed running invariant', () => {
  it('does not display generating artifacts as running when no real task exists', () => {
    const patch = resolveWorkspaceNodeRuntimePatch({
      node: node(),
      statesByQueryKey: new Map(),
      labels,
    })

    expect(patch.isRunning).toBe(false)
    expect(patch.statusLabel).toBe('Pending')
    expect(patch.taskProgress).toBeNull()
    expect(patch.editAssetGroupDetails?.assets[0]).toMatchObject({
      isRunning: false,
      statusLabel: 'Pending',
      taskProgress: null,
    })
  })

  it('requires a real taskId in addition to a queued or processing phase', () => {
    const withoutTaskId: TaskRuntimeStateLike = { phase: 'queued', runningTaskId: null }
    const withoutTaskIdPatch = resolveWorkspaceNodeRuntimePatch({
      node: node(),
      statesByQueryKey: new Map([[taskRuntimeTargetQueryKey(runtimeTarget), withoutTaskId]]),
      labels,
    })
    expect(withoutTaskIdPatch.isRunning).toBe(false)

    const withTaskId: TaskRuntimeStateLike = {
      phase: 'queued',
      runningTaskId: 'task-image-1',
      runningTaskType: 'image_character',
    }
    const withTaskIdPatch = resolveWorkspaceNodeRuntimePatch({
      node: node(),
      statesByQueryKey: new Map([[taskRuntimeTargetQueryKey(runtimeTarget), withTaskId]]),
      labels,
    })
    expect(withTaskIdPatch.isRunning).toBe(true)
    expect(withTaskIdPatch.taskProgress).toBe(withTaskId)
  })
})
