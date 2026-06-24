import { describe, expect, it } from 'vitest'
import {
  applyWorkspaceStructuredStreamPatches,
  shouldClearStreamAccumulatorsForLifecycle,
} from '@/features/project-workspace/canvas/structured-stream/useWorkspaceStructuredStreamRuntime'
import { TASK_EVENT_TYPE } from '@/lib/task/types'
import type { WorkspaceCanvasFlowNode } from '@/features/project-workspace/canvas/node-canvas-types'
import type { WorkspaceCanvasStreamPatch } from '@/features/project-workspace/canvas/structured-stream/workspace-structured-stream-runtime-types'
import {
  workspaceNodeId,
  workspaceEditCinematographyShotPlanNodeId,
  workspaceEditDirectorDecoupageNodeId,
} from '@/features/project-workspace/canvas/workspace-canvas-node-ids'

function editScriptNode(input: {
  readonly id: string
  readonly targetType: WorkspaceCanvasFlowNode['data']['targetType']
  readonly isRunning?: boolean
  readonly shotCount?: number
}): WorkspaceCanvasFlowNode {
  const shots = Array.from({ length: input.shotCount ?? 0 }, (_, index) => ({
    shotNumber: index + 1,
    durationSec: 3,
    dramaticPurpose: 'purpose',
    visibleAction: 'action',
    audienceFocus: 'focus',
    viewpoint: 'view',
    revealPlan: 'reveal',
    performanceBeat: 'beat',
    continuityIn: 'in',
    continuityOut: 'out',
    charactersAndScene: 'scene',
    sound: 'sound',
  }))
  return {
    id: input.id,
    type: 'workspaceNode',
    position: { x: 10, y: 20 },
    style: { width: 760, height: 520 },
    data: {
      nodeId: input.id,
      kind: 'editScript',
      layoutNodeType: 'editScript',
      targetType: input.targetType,
      targetId: input.targetType === 'episode' ? 'episode-1' : 'edit-script-1',
      title: input.id,
      eyebrow: 'eyebrow',
      body: 'official body',
      meta: 'official meta',
      statusLabel: input.isRunning ? 'processing' : 'ready',
      isRunning: input.isRunning ?? false,
      width: 760,
      height: 520,
      runtimeTargets: [{
        targetType: 'ProjectEpisode',
        targetId: 'episode-1',
        types: ['edit_script_generate'],
      }],
      actionLabel: 'Generate',
      action: { type: 'generate_edit_script', screenplayId: 'screenplay-1' },
      editScriptDetails: shots.length > 0
        ? {
            durationSec: 3,
            shotCount: shots.length,
            shots,
          }
        : undefined,
    },
  }
}

function pipelineNode(input: {
  readonly id: string
  readonly kind: 'editDirectorDecoupage' | 'editCinematographyShotPlan'
  readonly targetType: WorkspaceCanvasFlowNode['data']['targetType']
  readonly targetId: string
  readonly isRunning: boolean
  readonly itemTitles?: readonly string[]
}): WorkspaceCanvasFlowNode {
  const itemTitles = input.itemTitles ?? ['Shot 1']
  return {
    id: input.id,
    type: 'workspaceNode',
    position: { x: 10, y: 20 },
    data: {
      nodeId: input.id,
      kind: input.kind,
      layoutNodeType: input.kind,
      targetType: input.targetType,
      targetId: input.targetId,
      title: input.id,
      eyebrow: 'eyebrow',
      body: 'official body',
      meta: 'official meta',
      statusLabel: input.isRunning ? 'processing' : 'ready',
      isRunning: input.isRunning,
      width: 520,
      height: 360,
      editPipelineStepDetails: {
        items: itemTitles.map((title) => ({
          title,
          fields: [{ label: 'Field', value: 'Value' }],
        })),
      },
    },
  }
}

function screenplayNode(input: {
  readonly id: string
  readonly targetId: string
  readonly isRunning: boolean
  readonly screenplayText: string
}): WorkspaceCanvasFlowNode {
  return {
    id: input.id,
    type: 'workspaceNode',
    position: { x: 10, y: 20 },
    data: {
      nodeId: input.id,
      kind: 'editScreenplay',
      layoutNodeType: 'editScreenplay',
      targetType: 'editScreenplay',
      targetId: input.targetId,
      title: input.id,
      eyebrow: 'eyebrow',
      body: 'official body',
      meta: 'official meta',
      statusLabel: input.isRunning ? 'processing' : 'ready',
      isRunning: input.isRunning,
      width: 520,
      height: 360,
      editScreenplayDetails: {
        screenplayText: input.screenplayText,
        userPrompt: 'prompt',
      },
    },
  }
}

function shotNode(input: {
  readonly id: string
  readonly storyboardId: string
}): WorkspaceCanvasFlowNode {
  return {
    id: input.id,
    type: 'workspaceNode',
    position: { x: 10, y: 20 },
    data: {
      nodeId: input.id,
      kind: 'shot',
      layoutNodeType: 'shot',
      targetType: 'panel',
      targetId: input.id,
      storyboardId: input.storyboardId,
      title: input.id,
      eyebrow: 'eyebrow',
      body: 'body',
      meta: 'meta',
      statusLabel: 'ready',
      isRunning: false,
      width: 320,
      height: 560,
    },
  }
}

describe('structured stream runtime patches', () => {
  it('clears stale stream accumulators when watchdog requeues the same task', () => {
    expect(shouldClearStreamAccumulatorsForLifecycle(TASK_EVENT_TYPE.CREATED, {
      reason: 'watchdog_requeue',
    })).toBe(true)
    expect(shouldClearStreamAccumulatorsForLifecycle(TASK_EVENT_TYPE.COMPLETED, {
      reason: 'watchdog_requeue',
    })).toBe(false)
    expect(shouldClearStreamAccumulatorsForLifecycle(TASK_EVENT_TYPE.CREATED, {
      reason: 'initial_submit',
    })).toBe(false)
  })

  it('applies a stream patch without replacing base node structure', () => {
    const base = editScriptNode({
      id: 'edit-script:episode-1',
      targetType: 'editScript',
      isRunning: true,
    })
    const patch: WorkspaceCanvasStreamPatch = {
      nodeId: 'edit-script:episode-1',
      streamKind: 'editScript',
      taskId: 'task-1',
      data: {
        body: 'streamed core table',
        statusLabel: 'processing',
        isRunning: true,
        editScriptDetails: {
          durationSec: 5,
          shotCount: 1,
          shots: [{
            shotNumber: 1,
            durationSec: 5,
            dramaticPurpose: 'purpose',
            visibleAction: 'action',
            audienceFocus: 'focus',
            viewpoint: 'view',
            revealPlan: 'reveal',
            performanceBeat: 'beat',
            continuityIn: 'in',
            continuityOut: 'out',
            charactersAndScene: 'scene',
            sound: 'sound',
          }],
        },
      },
    }

    const merged = applyWorkspaceStructuredStreamPatches([base], [patch])

    expect(merged).toHaveLength(1)
    expect(merged[0]?.id).toBe('edit-script:episode-1')
    expect(merged[0]?.position).toEqual({ x: 10, y: 20 })
    expect(merged[0]?.style).toEqual({ width: 760, height: 520 })
    expect(merged[0]?.data.body).toBe('streamed core table')
    expect(merged[0]?.data.targetType).toBe('editScript')
    expect(merged[0]?.data.targetId).toBe('edit-script-1')
    expect(merged[0]?.data.runtimeTargets).toEqual(base.data.runtimeTargets)
    expect(merged[0]?.data.action).toEqual(base.data.action)
  })

  it('fails explicitly when a stream patch has no canonical projection node', () => {
    const patch: WorkspaceCanvasStreamPatch = {
      nodeId: 'edit-script:episode-1',
      streamKind: 'editScript',
      taskId: 'task-1',
      data: {
        body: 'streamed core table',
      },
    }

    expect(() => applyWorkspaceStructuredStreamPatches([], [patch])).toThrow(
      'WORKSPACE_STREAM_PATCH_WITHOUT_CANONICAL_NODE:editScript:edit-script:episode-1:task-1',
    )
  })

  it('does not override persisted edit script rows with stale stream data', () => {
    const official = editScriptNode({
      id: 'edit-script:episode-1',
      targetType: 'editScript',
      shotCount: 1,
    })
    const patch: WorkspaceCanvasStreamPatch = {
      nodeId: 'edit-script:episode-1',
      streamKind: 'editScript',
      taskId: 'task-1',
      data: {
        body: 'streamed core table',
      },
    }

    const merged = applyWorkspaceStructuredStreamPatches([official], [patch])

    expect(merged).toHaveLength(1)
    expect(merged[0]?.data.body).toBe('official body')
  })

  it('keeps screenplay stream text until persisted screenplay text is ready', () => {
    const base = screenplayNode({
      id: 'edit-screenplay:screenplay-1',
      targetId: 'screenplay-1',
      isRunning: true,
      screenplayText: '',
    })
    const patch: WorkspaceCanvasStreamPatch = {
      nodeId: 'edit-screenplay:screenplay-1',
      streamKind: 'editScreenplay',
      taskId: 'task-screenplay',
      data: {
        body: 'streamed screenplay',
        editScreenplayDetails: {
          screenplayText: 'streamed screenplay',
          userPrompt: '',
        },
      },
    }

    const merged = applyWorkspaceStructuredStreamPatches([base], [patch])

    expect(merged).toHaveLength(1)
    expect(merged[0]?.data.body).toBe('streamed screenplay')
    expect(merged[0]?.position).toEqual({ x: 10, y: 20 })
  })

  it('does not override persisted screenplay text with stale stream text', () => {
    const official = screenplayNode({
      id: 'edit-screenplay:screenplay-1',
      targetId: 'screenplay-1',
      isRunning: false,
      screenplayText: 'official screenplay',
    })
    const patch: WorkspaceCanvasStreamPatch = {
      nodeId: 'edit-screenplay:screenplay-1',
      streamKind: 'editScreenplay',
      taskId: 'task-screenplay',
      data: {
        body: 'streamed screenplay',
      },
    }

    const merged = applyWorkspaceStructuredStreamPatches([official], [patch])

    expect(merged).toHaveLength(1)
    expect(merged[0]?.data.body).toBe('official body')
  })

  it('keeps director decoupage stream details while the official node is only an empty placeholder', () => {
    const nodeId = workspaceEditDirectorDecoupageNodeId('screenplay-1')
    const official = pipelineNode({
      id: nodeId,
      kind: 'editDirectorDecoupage',
      targetType: 'editScreenplay',
      targetId: 'screenplay-1',
      isRunning: false,
      itemTitles: [],
    })
    const patch: WorkspaceCanvasStreamPatch = {
      nodeId,
      streamKind: 'editDirectorDecoupage',
      taskId: 'task-director',
      data: {
        isRunning: true,
        editPipelineStepDetails: {
          items: [{
            title: 'Streamed director shot',
            fields: [{ label: 'Field', value: 'Value' }],
          }],
        },
      },
    }

    const merged = applyWorkspaceStructuredStreamPatches([official], [patch])

    expect(merged).toHaveLength(1)
    expect(merged[0]?.data.isRunning).toBe(true)
    expect(merged[0]?.data.editPipelineStepDetails?.items.map((item) => item.title)).toEqual([
      'Streamed director shot',
    ])
  })

  it('keeps cinematography stream details while the official node is only an empty placeholder', () => {
    const nodeId = workspaceEditCinematographyShotPlanNodeId('edit-script-1')
    const official = pipelineNode({
      id: nodeId,
      kind: 'editCinematographyShotPlan',
      targetType: 'editScript',
      targetId: 'edit-script-1',
      isRunning: false,
      itemTitles: [],
    })
    const patch: WorkspaceCanvasStreamPatch = {
      nodeId,
      streamKind: 'editCinematographyShotPlan',
      taskId: 'task-cinematography',
      data: {
        isRunning: true,
        editPipelineStepDetails: {
          items: [{
            title: 'Streamed cinematography shot',
            fields: [{ label: 'Field', value: 'Value' }],
          }],
        },
      },
    }

    const merged = applyWorkspaceStructuredStreamPatches([official], [patch])

    expect(merged).toHaveLength(1)
    expect(merged[0]?.data.isRunning).toBe(true)
    expect(merged[0]?.data.editPipelineStepDetails?.items.map((item) => item.title)).toEqual([
      'Streamed cinematography shot',
    ])
  })

  it('ignores storyboard generation patches after official shot nodes exist', () => {
    const officialShot = shotNode({
      id: workspaceNodeId.shot('panel-1'),
      storyboardId: 'storyboard-1',
    })
    const patch: WorkspaceCanvasStreamPatch = {
      nodeId: workspaceNodeId.storyboardPanelGeneration('storyboard-1'),
      streamKind: 'storyboardPanelGeneration',
      taskId: 'task-storyboard',
      data: {
        body: 'streamed storyboard prompts',
      },
    }

    const merged = applyWorkspaceStructuredStreamPatches([officialShot], [patch])

    expect(merged).toHaveLength(1)
    expect(merged[0]?.id).toBe(workspaceNodeId.shot('panel-1'))
  })
})
