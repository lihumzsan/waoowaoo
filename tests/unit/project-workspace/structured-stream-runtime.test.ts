import { describe, expect, it } from 'vitest'
import {
  applyWorkspaceStructuredStreamPatches,
} from '@/features/project-workspace/canvas/structured-stream/useWorkspaceStructuredStreamRuntime'
import type {
  WorkspaceCanvasFlowNode,
  WorkspaceCanvasNodeData,
} from '@/features/project-workspace/canvas/node-canvas-types'
import type {
  WorkspaceCanvasStreamPatch,
} from '@/features/project-workspace/canvas/structured-stream/workspace-structured-stream-runtime-types'

function workspaceNode(input: {
  readonly id: string
  readonly kind: WorkspaceCanvasNodeData['kind']
  readonly targetType: WorkspaceCanvasNodeData['targetType']
  readonly targetId: string
  readonly body?: string
}): WorkspaceCanvasFlowNode {
  return {
    id: input.id,
    type: 'workspaceNode',
    position: { x: 0, y: 0 },
    data: {
      kind: input.kind,
      layoutNodeType: input.kind,
      targetType: input.targetType,
      targetId: input.targetId,
      title: input.id,
      eyebrow: input.kind,
      body: input.body ?? 'base',
      meta: '',
      statusLabel: '',
      width: 240,
      height: 160,
    },
  }
}

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

  it('applies a patch to the matching canonical node', () => {
    const nodes = [
      workspaceNode({
        id: 'edit-shot-execution-plan:edit-script:script-1',
        kind: 'editShotExecutionPlan',
        targetType: 'editShotExecutionPlan',
        targetId: 'script-1',
      }),
    ]
    const patches: WorkspaceCanvasStreamPatch[] = [{
      nodeId: 'edit-shot-execution-plan:edit-script:script-1',
      streamKind: 'editShotExecutionPlan',
      taskId: 'task-1',
      data: {
        body: 'streamed',
        isRunning: true,
      },
    }]

    const result = applyWorkspaceStructuredStreamPatches(nodes, patches)

    expect(result[0]?.data.body).toBe('streamed')
    expect(result[0]?.data.isRunning).toBe(true)
  })

  it('leaves off-projection batch patches unapplied instead of crashing the canvas', () => {
    const nodes = [
      workspaceNode({
        id: 'edit-shot-execution-plan:edit-script:visible-script',
        kind: 'editShotExecutionPlan',
        targetType: 'editShotExecutionPlan',
        targetId: 'visible-script',
      }),
    ]
    const patches: WorkspaceCanvasStreamPatch[] = [{
      nodeId: 'edit-shot-execution-plan:edit-script:hidden-script',
      streamKind: 'editShotExecutionPlan',
      taskId: 'task-hidden',
      data: {
        body: 'hidden streamed body',
        isRunning: true,
      },
    }]

    expect(() => applyWorkspaceStructuredStreamPatches(nodes, patches)).not.toThrow()
    expect(applyWorkspaceStructuredStreamPatches(nodes, patches)).toEqual(nodes)
  })

  it('does not let source script stream patches overwrite persisted source script details', () => {
    const nodes = [
      workspaceNode({
        id: 'edit-source-script:episode:episode-1',
        kind: 'editSourceScript',
        targetType: 'editSourceScript',
        targetId: 'bible-1',
        body: 'persisted source',
      }),
    ].map((node) => ({
      ...node,
      data: {
        ...node.data,
        isRunning: false,
        sourceScriptDetails: {
          sourceText: 'persisted source',
          scriptStructure: {
            version: 1,
            title: 'Persisted',
            summary: 'Persisted summary',
            episodes: [],
          },
        },
      },
    }))
    const patches: WorkspaceCanvasStreamPatch[] = [{
      nodeId: 'edit-source-script:episode:episode-1',
      streamKind: 'editSourceScript',
      taskId: 'task-1',
      data: {
        body: 'stream source',
        isRunning: true,
      },
    }]

    const result = applyWorkspaceStructuredStreamPatches(nodes, patches)

    expect(result[0]?.data.body).toBe('persisted source')
    expect(result[0]?.data.isRunning).toBe(false)
  })

  it('does not let production planning stream patches overwrite persisted production details', () => {
    const nodes = [
      workspaceNode({
        id: 'edit-bible:episode:episode-1',
        kind: 'editBible',
        targetType: 'editBible',
        targetId: 'bible-1',
        body: 'persisted plan',
      }),
    ].map((node) => ({
      ...node,
      data: {
        ...node.data,
        isRunning: false,
        editBibleDetails: {
          bibleText: 'persisted plan',
          bible: {
            synopsis: 'persisted plan',
            characters: [],
            locations: [],
            worldRules: [],
            styleGuide: {},
          },
          chapters: [],
        },
      },
    }))
    const patches: WorkspaceCanvasStreamPatch[] = [{
      nodeId: 'edit-bible:episode:episode-1',
      streamKind: 'editBible',
      taskId: 'task-1',
      data: {
        body: 'stream plan',
        isRunning: true,
      },
    }]

    const result = applyWorkspaceStructuredStreamPatches(nodes, patches)

    expect(result[0]?.data.body).toBe('persisted plan')
    expect(result[0]?.data.isRunning).toBe(false)
  })
})
