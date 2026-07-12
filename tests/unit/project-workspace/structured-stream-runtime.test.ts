import { describe, expect, it } from 'vitest'
import {
  addBoundedIdentity,
  buildStreamRuntimeEntries,
  isTerminalStructuredStreamLifecycle,
  processStructuredStreamEvent,
  snapshotsFromAccumulators,
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

  function productionPlanningChunk(params: {
    stepId: string
    streamRunId: string
    delta: string
  }): TaskSSEEvent {
    return {
      ...chunk({ seq: 1, streamRunId: params.streamRunId, delta: params.delta }),
      id: `stream-${params.streamRunId}-1`,
      taskType: TASK_TYPE.EDIT_BIBLE_GENERATE,
      targetType: 'ProjectEditBible',
      payload: {
        stepId: params.stepId,
        stepAttempt: 1,
        streamRunId: params.streamRunId,
        stream: { kind: 'text', lane: 'main', seq: 1, delta: params.delta },
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

  it('projects the production raw beat, ledger, and emotional schemas while the task is processing', () => {
    const anchor = {
      startBlockId: 'p0001', startQuote: 'start', endBlockId: 'p0001', endQuote: 'end',
    }
    let accumulators = processStructuredStreamEvent(new Map(), productionPlanningChunk({
      stepId: AI_PROMPT_IDS.EDIT_BIBLE_BEAT_SHEET,
      streamRunId: 'beat-run',
      delta: JSON.stringify({ beats: [{
        beatId: 'beat-1', title: 'Opening', summary: 'The story opens.',
        estimatedDurationSec: 12, sourceAnchor: anchor,
      }] }),
    }))
    accumulators = processStructuredStreamEvent(accumulators, productionPlanningChunk({
      stepId: AI_PROMPT_IDS.EDIT_BIBLE_LEDGER,
      streamRunId: 'ledger-run',
      delta: JSON.stringify({ events: [{
        eventId: 'event-1', kind: 'plot', summary: 'A discovery.', entities: [],
        persistentFacts: ['The clue exists.'], beatId: 'beat-1',
      }] }),
    }))
    accumulators = processStructuredStreamEvent(accumulators, productionPlanningChunk({
      stepId: AI_PROMPT_IDS.EDIT_BIBLE_EMOTIONAL_CURVE,
      streamRunId: 'curve-run',
      delta: JSON.stringify({ cues: [{
        cueId: 'cue-1', mood: 'tense', intensity: 0.8, musicPolicy: 'underscore',
        sourceAnchor: anchor,
      }] }),
    }))

    const entries = buildStreamRuntimeEntries(snapshotsFromAccumulators(accumulators), 'episode-1', (key) => key)

    expect(entries).toHaveLength(1)
    expect(entries[0]?.patch.data.editBibleDetails).toMatchObject({
      beatSheet: { beats: [{ beatId: 'beat-1', sourceAnchor: anchor }] },
      ledger: { events: [{ eventId: 'event-1', beatId: 'beat-1' }] },
      emotionalCurve: { cues: [{ cueId: 'cue-1', sourceAnchor: anchor }] },
    })
    expect(entries[0]?.patch).not.toHaveProperty('error')
  })

  it('skips an invalid preview item without hiding later valid content or creating a failure patch', () => {
    const anchor = {
      startBlockId: 'p0001', startQuote: 'start', endBlockId: 'p0001', endQuote: 'end',
    }
    const accumulators = processStructuredStreamEvent(new Map(), productionPlanningChunk({
      stepId: AI_PROMPT_IDS.EDIT_BIBLE_BEAT_SHEET,
      streamRunId: 'mixed-beat-run',
      delta: JSON.stringify({ beats: [
        { beatId: 'invalid-without-anchor', title: 'Invalid', summary: 'Invalid.', estimatedDurationSec: 4 },
        { beatId: 'beat-2', title: 'Valid', summary: 'Valid.', estimatedDurationSec: 5, sourceAnchor: anchor },
      ] }),
    }))

    const snapshots = snapshotsFromAccumulators(accumulators)
    const entries = buildStreamRuntimeEntries(snapshots, 'episode-1', (key) => key)

    expect(snapshots[0]?.errorMessage).toBeTruthy()
    expect(entries[0]?.patch.data.editBibleDetails).toMatchObject({
      beatSheet: { beats: [{ beatId: 'beat-2' }] },
    })
    expect(entries[0]?.patch).not.toHaveProperty('error')
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
