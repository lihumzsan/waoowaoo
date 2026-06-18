import { describe, expect, it } from 'vitest'
import { mergeWorkspaceStructuredStreamOverlayNodes } from '@/features/project-workspace/canvas/structured-stream/useWorkspaceStructuredStreamOverlay'
import type { WorkspaceCanvasFlowNode } from '@/features/project-workspace/canvas/node-canvas-types'

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
})
