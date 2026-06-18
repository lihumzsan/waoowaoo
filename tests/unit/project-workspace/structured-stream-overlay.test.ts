import { describe, expect, it } from 'vitest'
import { mergeWorkspaceStructuredStreamOverlayNodes } from '@/features/project-workspace/canvas/structured-stream/useWorkspaceStructuredStreamOverlay'
import type { WorkspaceCanvasFlowNode } from '@/features/project-workspace/canvas/node-canvas-types'
import {
  workspaceEditCinematographyShotPlanNodeId,
  workspaceEditDirectorDecoupageNodeId,
} from '@/features/project-workspace/canvas/workspace-canvas-node-ids'

function node(id: string, targetType: WorkspaceCanvasFlowNode['data']['targetType']): WorkspaceCanvasFlowNode {
  return {
    id,
    type: 'workspaceNode',
    position: { x: 10, y: 20 },
    data: {
      nodeId: id,
      kind: 'editScript',
      layoutNodeType: 'editScript',
      targetType,
      targetId: targetType === 'episode' ? 'episode-1' : 'edit-script-1',
      title: id,
      eyebrow: 'eyebrow',
      body: 'body',
      meta: 'meta',
      statusLabel: 'status',
      width: 760,
      height: 520,
      ...(targetType === 'editScript'
        ? {
            editScriptDetails: {
              durationSec: 3,
              shotCount: 1,
              shots: [{
                shotNumber: 1,
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
              }],
            },
          }
        : {}),
    },
  }
}

function pipelineNode(input: {
  readonly id: string
  readonly kind: 'editDirectorDecoupage' | 'editCinematographyShotPlan'
  readonly targetType: WorkspaceCanvasFlowNode['data']['targetType']
  readonly targetId: string
  readonly isRunning: boolean
}): WorkspaceCanvasFlowNode {
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
      body: 'body',
      meta: 'meta',
      statusLabel: input.isRunning ? 'processing' : 'ready',
      isRunning: input.isRunning,
      width: 520,
      height: 360,
      editPipelineStepDetails: {
        items: [{
          title: 'Shot 1',
          fields: [{ label: 'Field', value: 'Value' }],
        }],
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
      body: input.screenplayText,
      meta: 'meta',
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

describe('structured stream overlay merge', () => {
  it('replaces the pending node while preserving its canvas position', () => {
    const base = node('edit-script:pending:episode-1', 'episode')
    const overlay = {
      ...node('edit-script:pending:episode-1', 'episode'),
      position: { x: 999, y: 999 },
      data: {
        ...node('edit-script:pending:episode-1', 'episode').data,
        title: 'stream overlay',
      },
    }

    const merged = mergeWorkspaceStructuredStreamOverlayNodes([base], [overlay])

    expect(merged).toHaveLength(1)
    expect(merged[0]?.data.title).toBe('stream overlay')
    expect(merged[0]?.position).toEqual({ x: 10, y: 20 })
  })

  it('drops edit script overlay after official edit script details exist', () => {
    const official = node('edit-script:edit-script-1', 'editScript')
    const overlay = node('edit-script:pending:episode-1', 'episode')

    const merged = mergeWorkspaceStructuredStreamOverlayNodes([official], [overlay])

    expect(merged.map((item) => item.id)).toEqual(['edit-script:edit-script-1'])
  })

  it('replaces the persisted running screenplay node with text stream overlay while preserving position', () => {
    const base = screenplayNode({
      id: 'edit-screenplay:screenplay-1',
      targetId: 'screenplay-1',
      isRunning: true,
      screenplayText: '',
    })
    const overlay = {
      ...screenplayNode({
        id: 'edit-screenplay:screenplay-1',
        targetId: 'screenplay-1',
        isRunning: true,
        screenplayText: 'streamed screenplay',
      }),
      position: { x: 999, y: 999 },
    }

    const merged = mergeWorkspaceStructuredStreamOverlayNodes([base], [overlay])

    expect(merged).toHaveLength(1)
    expect(merged[0]?.data.body).toBe('streamed screenplay')
    expect(merged[0]?.position).toEqual({ x: 10, y: 20 })
  })

  it('drops screenplay text overlay after official screenplay details are ready', () => {
    const official = screenplayNode({
      id: 'edit-screenplay:screenplay-1',
      targetId: 'screenplay-1',
      isRunning: false,
      screenplayText: 'official screenplay',
    })
    const overlay = screenplayNode({
      id: 'edit-screenplay:screenplay-1',
      targetId: 'screenplay-1',
      isRunning: true,
      screenplayText: 'streamed screenplay',
    })

    const merged = mergeWorkspaceStructuredStreamOverlayNodes([official], [overlay])

    expect(merged).toHaveLength(1)
    expect(merged[0]?.data.body).toBe('official screenplay')
  })

  it('drops director decoupage pending overlay after official director decoupage exists', () => {
    const nodeId = workspaceEditDirectorDecoupageNodeId('screenplay-1')
    const official = pipelineNode({
      id: nodeId,
      kind: 'editDirectorDecoupage',
      targetType: 'editScreenplay',
      targetId: 'screenplay-1',
      isRunning: false,
    })
    const overlay = pipelineNode({
      id: nodeId,
      kind: 'editDirectorDecoupage',
      targetType: 'editScreenplay',
      targetId: 'screenplay-1',
      isRunning: true,
    })

    const merged = mergeWorkspaceStructuredStreamOverlayNodes([official], [overlay])

    expect(merged.map((item) => item.id)).toEqual([nodeId])
  })

  it('drops cinematography pending overlay after official shot plan exists', () => {
    const nodeId = workspaceEditCinematographyShotPlanNodeId('edit-script-1')
    const official = pipelineNode({
      id: nodeId,
      kind: 'editCinematographyShotPlan',
      targetType: 'editScript',
      targetId: 'edit-script-1',
      isRunning: false,
    })
    const overlay = pipelineNode({
      id: nodeId,
      kind: 'editCinematographyShotPlan',
      targetType: 'editScript',
      targetId: 'edit-script-1',
      isRunning: true,
    })

    const merged = mergeWorkspaceStructuredStreamOverlayNodes([official], [overlay])

    expect(merged.map((item) => item.id)).toEqual([nodeId])
  })

  it('replaces stable director decoupage pending node while preserving position', () => {
    const nodeId = workspaceEditDirectorDecoupageNodeId('screenplay-1')
    const base = pipelineNode({
      id: nodeId,
      kind: 'editDirectorDecoupage',
      targetType: 'editScreenplay',
      targetId: 'screenplay-1',
      isRunning: true,
    })
    const overlay = {
      ...base,
      position: { x: 999, y: 999 },
      data: {
        ...base.data,
        title: 'stream director overlay',
      },
    }

    const merged = mergeWorkspaceStructuredStreamOverlayNodes([base], [overlay])

    expect(merged).toHaveLength(1)
    expect(merged[0]?.data.title).toBe('stream director overlay')
    expect(merged[0]?.position).toEqual({ x: 10, y: 20 })
  })
})
