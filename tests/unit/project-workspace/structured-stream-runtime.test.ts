import { describe, expect, it } from 'vitest'
import {
  addBoundedIdentity,
  buildStreamRuntimeEntries,
  isTerminalStructuredStreamLifecycle,
  processStructuredStreamEvent,
  type StructuredStreamSnapshot,
} from '@/features/project-workspace/canvas/structured-stream/useWorkspaceStructuredStreamRuntime'
import type { WorkspaceCanvasFlowNode } from '@/features/project-workspace/canvas/node-canvas-types'
import type { WorkspaceCanvasLifecycle } from '@/features/project-workspace/canvas/lifecycle/workspace-canvas-lifecycle'
import type { WorkspaceCanvasStreamPatch } from '@/features/project-workspace/canvas/structured-stream/workspace-structured-stream-runtime-types'
import { resolveWorkspaceCanvasNodeData } from '@/features/project-workspace/canvas/workspace-node-runtime'
import { taskRuntimeTargetQueryKey } from '@/lib/task/runtime-targets'
import { TASK_EVENT_TYPE, TASK_SSE_EVENT_TYPE, TASK_TYPE, type TaskSSEEvent } from '@/lib/task/types'
import { AI_PROMPT_IDS } from '@/lib/ai-prompts/ids'

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
  function chunk(params: {
    seq: number
    attempt?: number
    streamRunId?: string
    delta?: string
  }): TaskSSEEvent {
    return {
      id: `stream-${params.streamRunId ?? 'run-1'}-${String(params.seq)}`,
      type: TASK_SSE_EVENT_TYPE.STREAM,
      taskId: 'task-1',
      taskType: TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE,
      targetType: 'ProjectEditSourceScript',
      targetId: 'bible-1',
      episodeId: 'episode-1',
      projectId: 'project-1',
      userId: 'user-1',
      ts: '2026-07-11T00:00:00.000Z',
      payload: {
        stepId: AI_PROMPT_IDS.EDIT_BIBLE_OUTLINE_SCRIPT,
        stepAttempt: params.attempt ?? 1,
        streamRunId: params.streamRunId ?? 'run-1',
        stream: {
          kind: 'text',
          lane: 'main',
          seq: params.seq,
          delta: params.delta ?? '{"segments":[',
        },
      },
    }
  }

  it('accepts only contiguous seq for the current stream run and step attempt', () => {
    const first = processStructuredStreamEvent(new Map(), chunk({ seq: 1 }))
    const duplicate = processStructuredStreamEvent(first, chunk({ seq: 1 }))
    const gap = processStructuredStreamEvent(first, chunk({ seq: 3 }))
    const second = processStructuredStreamEvent(first, chunk({ seq: 2, delta: ']' }))

    expect([...first.values()][0]?.lastSeq).toBe(1)
    expect(duplicate).toEqual(first)
    expect(gap).toEqual(first)
    expect([...second.values()][0]?.lastSeq).toBe(2)
  })

  it('replaces an older step attempt while a distinct retry streamRunId remains admissible', () => {
    const firstAttempt = processStructuredStreamEvent(new Map(), chunk({
      seq: 1,
      attempt: 1,
      streamRunId: 'run-attempt-1',
    }))
    const retryAttempt = processStructuredStreamEvent(firstAttempt, chunk({
      seq: 1,
      attempt: 2,
      streamRunId: 'run-attempt-2',
    }))
    const lateOldAttempt = processStructuredStreamEvent(retryAttempt, chunk({
      seq: 2,
      attempt: 1,
      streamRunId: 'run-attempt-1',
      delta: ']',
    }))

    expect([...retryAttempt.values()]).toHaveLength(1)
    expect([...retryAttempt.values()][0]).toMatchObject({
      streamRunId: 'run-attempt-2',
      stepAttempt: 2,
      lastSeq: 1,
    })
    expect(lateOldAttempt).toEqual(retryAttempt)
  })

  it('bounds terminal stream identities instead of growing for the lifetime of the tab', () => {
    let identities: ReadonlySet<string> = new Set()
    for (let index = 0; index < 20; index += 1) {
      identities = addBoundedIdentity(identities, `run-${String(index)}`, 8)
    }
    expect([...identities]).toEqual([
      'run-12', 'run-13', 'run-14', 'run-15', 'run-16', 'run-17', 'run-18', 'run-19',
    ])
  })

  it('treats canceled as a terminal lifecycle that clears structured runtime', () => {
    expect(isTerminalStructuredStreamLifecycle(TASK_EVENT_TYPE.CANCELED)).toBe(true)
  })
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

  it('clears completed stream state while the formal resource Query refetches', () => {
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
      phase: 'pending',
      error: null,
    })
  })
})
