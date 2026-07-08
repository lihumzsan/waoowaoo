import { describe, expect, it } from 'vitest'
import {
  applyWorkspaceStructuredStreamPatches,
} from '@/features/project-workspace/canvas/structured-stream/useWorkspaceStructuredStreamRuntime'
import type {
  WorkspaceCanvasFlowNode,
} from '@/features/project-workspace/canvas/node-canvas-types'
import type {
  WorkspaceCanvasStreamPatch,
} from '@/features/project-workspace/canvas/structured-stream/workspace-structured-stream-runtime-types'

describe('workspace structured stream runtime', () => {
  it('keeps unmatched stream patches buffered instead of throwing during render', () => {
    const patch: WorkspaceCanvasStreamPatch = {
      streamKind: 'editScript',
      nodeId: 'edit-script:episode-1:chapter-1',
      taskId: 'task-1',
      data: {
        isRunning: true,
        statusLabel: 'processing',
      },
    }

    expect(() => applyWorkspaceStructuredStreamPatches([], [patch])).not.toThrow()
  })

  it('applies buffered patches once the canonical node exists', () => {
    const node = {
      id: 'edit-script:episode-1:chapter-1',
      data: {
        kind: 'editScript',
        layoutNodeType: 'editScript',
        targetType: 'editScript',
        targetId: 'chapter-1',
        nodeId: 'edit-script:episode-1:chapter-1',
      },
    } as unknown as WorkspaceCanvasFlowNode
    const patch: WorkspaceCanvasStreamPatch = {
      streamKind: 'editScript',
      nodeId: node.id,
      taskId: 'task-1',
      data: {
        isRunning: true,
        statusLabel: 'processing',
      },
    }

    expect(applyWorkspaceStructuredStreamPatches([node], [patch])[0]?.data.isRunning).toBe(true)
  })
})
