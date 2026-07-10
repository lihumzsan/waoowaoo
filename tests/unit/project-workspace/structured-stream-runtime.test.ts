import { describe, expect, it } from 'vitest'
import { buildStreamRuntimeEntries, type StructuredStreamSnapshot } from '@/features/project-workspace/canvas/structured-stream/useWorkspaceStructuredStreamRuntime'
import type { WorkspaceCanvasFlowNode } from '@/features/project-workspace/canvas/node-canvas-types'
import type { WorkspaceCanvasLifecycle } from '@/features/project-workspace/canvas/lifecycle/workspace-canvas-lifecycle'
import type { WorkspaceCanvasStreamPatch } from '@/features/project-workspace/canvas/structured-stream/workspace-structured-stream-runtime-types'
import { resolveWorkspaceCanvasNodeData } from '@/features/project-workspace/canvas/workspace-node-runtime'
import { taskRuntimeTargetQueryKey } from '@/lib/task/runtime-targets'

const pendingLifecycle = {
  phase: 'pending', taskId: null, taskType: null, progress: null, error: null, stream: null,
} as const

const runtimeTarget = {
  targetType: 'ProjectEditSourceScript',
  targetId: 'bible-1',
  types: ['edit_source_script_generate'],
} as const

function sourceNode(lifecycle: WorkspaceCanvasLifecycle = pendingLifecycle): WorkspaceCanvasFlowNode {
  return {
    id: 'edit-source-script:episode:episode-1',
    type: 'workspaceNode',
    position: { x: 0, y: 0 },
    data: {
      kind: 'editSourceScript',
      mediaLoadingContext: null,
      layoutNodeType: 'editSourceScript',
      targetType: 'editSourceScript',
      targetId: 'bible-1',
      title: 'Source',
      eyebrow: 'Source',
      body: 'persisted source',
      meta: '',
      lifecycle,
      runtimeTargets: [runtimeTarget],
      width: 760,
      height: 360,
      sourceScriptDetails: {
        sourceText: 'persisted source',
        scriptStructure: null,
      },
    },
  }
}

function streamPatch(): WorkspaceCanvasStreamPatch {
  return {
    nodeId: 'edit-source-script:episode:episode-1',
    streamKind: 'editSourceScript',
    taskId: 'task-1',
    taskType: 'edit_source_script_generate',
    presentation: {
      isStreaming: true,
      activeItemKey: '0:0:0',
      displayedItemKeys: ['0:0:0'],
      pinnedItemKeys: [],
      revealedFieldCountByKey: {},
    },
    error: null,
    data: {
      body: 'streamed scene',
      sourceScriptDetails: {
        sourceText: 'streamed scene',
        scriptStructure: null,
      },
    },
  }
}

describe('workspace structured stream runtime', () => {
  it('emits one source-script card update as soon as a scene segment completes', () => {
    const segment = {
      episodeIndex: 0,
      episodeTitle: 'Episode',
      episodeSummary: 'Episode summary',
      actIndex: 0,
      actTitle: 'Act',
      actSummary: 'Act summary',
      sceneIndex: 0,
      title: 'Scene',
      location: 'Room',
      timeOfDay: 'Night',
      characters: ['A'],
      summary: 'A enters.',
      body: 'INT. ROOM - NIGHT\nA enters.',
      beats: [{ beatIndex: 0, title: 'Enter', summary: 'A enters.' }],
    }
    const snapshots: readonly StructuredStreamSnapshot[] = [{
      taskId: 'task-1',
      taskType: 'edit_source_script_generate',
      targetType: 'ProjectEditSourceScript',
      targetId: 'bible-1',
      episodeId: 'episode-1',
      adapterKey: 'sourceScript.segments',
      items: [{
        adapterKey: 'sourceScript.segments',
        itemKey: '0:0:0',
        index: 0,
        value: { kind: 'sourceScriptSceneSegment', segment },
      }],
      errorMessage: null,
    }]

    const entries = buildStreamRuntimeEntries(snapshots, 'episode-1', (key) => key)

    expect(entries).toHaveLength(1)
    expect(entries[0]?.patch.data.sourceScriptDetails).toMatchObject({
      sourceText: 'INT. ROOM - NIGHT\nA enters.',
      scriptStructure: {
        episodes: [{ acts: [{ scenes: [{ sceneIndex: 0, body: 'INT. ROOM - NIGHT\nA enters.' }] }] }],
      },
    })
    expect(entries[0]?.patch.presentation.displayedItemKeys).toEqual(['0:0:0'])
  })

  it('merges stream content only for the matching active task', () => {
    const state = {
      phase: 'processing',
      taskId: 'task-1',
      runningTaskId: 'task-1',
      runningTaskType: 'edit_source_script_generate',
    } as const
    const resolved = resolveWorkspaceCanvasNodeData({
      node: sourceNode(),
      statesByQueryKey: new Map([[taskRuntimeTargetQueryKey(runtimeTarget), state]]),
      streamPatch: streamPatch(),
      submitting: false,
    })

    expect(resolved.lifecycle.phase).toBe('streaming')
    expect(resolved.body).toBe('streamed scene')
  })

  it('rejects a late stream after the matching task reached terminal state', () => {
    const terminal = {
      phase: 'completed',
      taskId: 'task-1',
      runningTaskId: null,
      runningTaskType: 'edit_source_script_generate',
      progress: 100,
    } as const
    const succeededLifecycle = { ...pendingLifecycle, phase: 'succeeded' as const }
    const resolved = resolveWorkspaceCanvasNodeData({
      node: sourceNode(succeededLifecycle),
      statesByQueryKey: new Map([[taskRuntimeTargetQueryKey(runtimeTarget), terminal]]),
      streamPatch: streamPatch(),
      submitting: false,
    })

    expect(resolved.lifecycle.phase).toBe('succeeded')
    expect(resolved.body).toBe('persisted source')
  })

  it('surfaces completed-without-resource as an explicit contract failure', () => {
    const terminal = {
      phase: 'completed',
      taskId: 'task-1',
      runningTaskId: null,
      runningTaskType: 'edit_source_script_generate',
      progress: 100,
    } as const
    const resolved = resolveWorkspaceCanvasNodeData({
      node: sourceNode(),
      statesByQueryKey: new Map([[taskRuntimeTargetQueryKey(runtimeTarget), terminal]]),
      streamPatch: null,
      submitting: false,
    })

    expect(resolved.lifecycle).toMatchObject({
      phase: 'failed',
      error: { code: 'CANVAS_TERMINAL_RESOURCE_HANDOFF_MISSING' },
    })
  })
})
