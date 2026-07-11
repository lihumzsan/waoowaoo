import { describe, expect, it } from 'vitest'
import {
  isWorkspaceCanvasLifecycleRunning,
  isWorkspaceCanvasLifecycleStreaming,
  resolveWorkspaceCanvasLifecycle,
  workspaceCanvasLifecycleStatusKey,
  workspaceCanvasLifecycleTaskState,
  type WorkspaceCanvasLifecycle,
  type WorkspaceCanvasLifecycleFacts,
} from '@/features/project-workspace/canvas/lifecycle/workspace-canvas-lifecycle'

const presentation = {
  isStreaming: true,
  activeItemKey: 'item-1',
  displayedItemKeys: ['item-1'],
  pinnedItemKeys: [],
  revealedFieldCountByKey: { 'item-1': 2 },
} as const

function facts(overrides: Partial<WorkspaceCanvasLifecycleFacts> = {}): WorkspaceCanvasLifecycleFacts {
  return {
    persistedPhase: 'pending',
    task: null,
    stream: null,
    submitting: false,
    ...overrides,
  }
}

describe('workspace Canvas lifecycle resolver', () => {
  it('normalizes task identity and prefers the durable task id over the running fallback', () => {
    expect(resolveWorkspaceCanvasLifecycle(facts({
      task: {
        phase: 'queued',
        taskId: '  durable-task  ',
        runningTaskId: 'running-task',
        runningTaskType: '  image_panel  ',
      },
    }))).toEqual({
      phase: 'queued',
      taskId: 'durable-task',
      taskType: 'image_panel',
      progress: null,
      error: null,
      stream: null,
    })

    expect(resolveWorkspaceCanvasLifecycle(facts({
      task: { phase: 'queued', taskId: '  ', runningTaskId: '  fallback-task  ', runningTaskType: ' ' },
    }))).toMatchObject({ taskId: 'fallback-task', taskType: null })
    expect(resolveWorkspaceCanvasLifecycle(facts({
      task: { phase: 'queued', taskId: 7 as unknown as string, runningTaskId: null },
    }))).toMatchObject({ phase: 'pending', taskId: null })
  })

  it('clamps finite progress and rejects every non-numeric progress fact', () => {
    const cases: ReadonlyArray<readonly [unknown, number | null]> = [
      [-4, 0], [0, 0], [42.9, 42], [100, 100], [140, 100],
      [Number.NaN, null], [Number.POSITIVE_INFINITY, null], ['45', null], [null, null],
    ]
    for (const [progress, expected] of cases) {
      expect(resolveWorkspaceCanvasLifecycle(facts({
        task: {
          phase: 'queued',
          taskId: 'task-progress',
          progress: progress as number | null,
        },
      })).progress).toBe(expected)
    }
  })

  it('makes contract errors authoritative while retaining the best available identity', () => {
    const contractError = { code: 'CANVAS_CONTRACT_INVALID', message: 'Missing capability' }
    const stream = { taskId: 'stream-task', taskType: 'stream-type', presentation, error: null }

    expect(resolveWorkspaceCanvasLifecycle(facts({
      contractError,
      task: {
        phase: 'processing',
        taskId: 'task-id',
        runningTaskType: 'task-type',
        progress: 51.8,
      },
      stream,
    }))).toEqual({
      phase: 'failed', taskId: 'task-id', taskType: 'task-type', progress: 51,
      error: contractError, stream: null,
    })
    expect(resolveWorkspaceCanvasLifecycle(facts({ contractError, stream }))).toMatchObject({
      taskId: 'stream-task', taskType: 'stream-type', error: contractError,
    })
    expect(resolveWorkspaceCanvasLifecycle(facts({ contractError }))).toMatchObject({
      taskId: null, taskType: null, error: contractError,
    })
  })

  it('uses stream facts only when they belong to the active processing task', () => {
    const matchingStream = { taskId: 'task-1', taskType: 'stream-type', presentation, error: null }
    expect(resolveWorkspaceCanvasLifecycle(facts({
      task: { phase: 'processing', taskId: 'task-1', runningTaskType: null, progress: 25 },
      stream: matchingStream,
    }))).toEqual({
      phase: 'streaming', taskId: 'task-1', taskType: 'stream-type', progress: 25,
      error: null, stream: presentation,
    })
    expect(resolveWorkspaceCanvasLifecycle(facts({
      task: { phase: 'processing', taskId: 'task-1', runningTaskType: 'task-type', progress: 25 },
      stream: { ...matchingStream, taskId: 'stale-task' },
    }))).toEqual({
      phase: 'processing', taskId: 'task-1', taskType: 'task-type', progress: 25,
      error: null, stream: null,
    })

    const streamError = { code: 'STREAM_FAILED', message: 'Stream failed' }
    expect(resolveWorkspaceCanvasLifecycle(facts({
      task: { phase: 'processing', taskId: 'task-1' },
      stream: { ...matchingStream, error: streamError },
    }))).toMatchObject({ phase: 'failed', error: streamError, stream: presentation })
  })

  it('normalizes final task errors and uses explicit fallbacks in priority order', () => {
    expect(resolveWorkspaceCanvasLifecycle(facts({
      task: {
        phase: 'failed', taskId: 'task-1',
        lastError: { code: '  PROVIDER_FAILED  ', message: '  Provider failed  ' },
      },
    }))).toMatchObject({
      phase: 'failed', error: { code: 'PROVIDER_FAILED', message: 'Provider failed' },
    })
    expect(resolveWorkspaceCanvasLifecycle(facts({
      task: { phase: 'failed', taskId: 'task-2', lastError: { code: ' ', message: 'failed' } },
    }))).toMatchObject({ error: { code: 'TASK_FAILED', message: 'failed' } })
    expect(resolveWorkspaceCanvasLifecycle(facts({
      task: { phase: 'failed', taskId: 'task-missing-code', lastError: { message: 'failed' } },
    }))).toMatchObject({ error: { code: 'TASK_FAILED', message: 'failed' } })
    expect(resolveWorkspaceCanvasLifecycle(facts({
      task: {
        phase: 'failed',
        taskId: 'task-invalid-message',
        lastError: { message: 7 as unknown as string },
      },
    }))).toMatchObject({ error: { code: 'TASK_FAILED', message: 'Task failed' } })

    const streamError = { code: 'STREAM_FINAL', message: 'Stream final failure' }
    expect(resolveWorkspaceCanvasLifecycle(facts({
      task: { phase: 'failed', taskId: 'task-3', lastError: { code: 5 as unknown as string, message: ' ' } },
      stream: { taskId: 'task-3', taskType: null, presentation, error: streamError },
    }))).toMatchObject({ error: streamError })
    expect(resolveWorkspaceCanvasLifecycle(facts({
      task: { phase: 'failed', taskId: 'task-4', lastError: null },
    }))).toMatchObject({ error: { code: 'TASK_FAILED', message: 'Task failed' } })
  })

  it('keeps the persisted resource phase while a completed task notification refetches', () => {
    expect(resolveWorkspaceCanvasLifecycle(facts({
      task: { phase: 'completed', taskId: 'task-1', progress: 100 },
    }))).toEqual({
      phase: 'pending', taskId: 'task-1', taskType: null, progress: 100, stream: null,
      error: null,
    })
    for (const persistedPhase of ['succeeded', 'failed', 'canceled'] as const) {
      expect(resolveWorkspaceCanvasLifecycle(facts({
        persistedPhase,
        task: { phase: 'completed', taskId: 'task-1', runningTaskType: 'video_group' },
      }))).toEqual({
        phase: persistedPhase, taskId: 'task-1', taskType: 'video_group', progress: null,
        error: null, stream: null,
      })
    }
  })

  it('orders standalone stream, submission, and persisted facts without merging them', () => {
    const streamError = { code: 'STREAM_REJECTED', message: 'Rejected' }
    expect(resolveWorkspaceCanvasLifecycle(facts({
      stream: { taskId: 'stream-only', taskType: 'text_stream', presentation, error: null },
      submitting: true,
    }))).toEqual({
      phase: 'streaming', taskId: 'stream-only', taskType: 'text_stream', progress: null,
      error: null, stream: presentation,
    })
    expect(resolveWorkspaceCanvasLifecycle(facts({
      stream: { taskId: 'stream-error', taskType: null, presentation, error: streamError },
    }))).toMatchObject({ phase: 'failed', taskId: 'stream-error', error: streamError, stream: presentation })
    expect(resolveWorkspaceCanvasLifecycle(facts({ submitting: true }))).toEqual({
      phase: 'submitting', taskId: null, taskType: null, progress: null, error: null, stream: null,
    })
    expect(resolveWorkspaceCanvasLifecycle(facts({ persistedPhase: 'succeeded' }))).toEqual({
      phase: 'succeeded', taskId: null, taskType: null, progress: null, error: null, stream: null,
    })
    expect(resolveWorkspaceCanvasLifecycle(facts({
      persistedPhase: 'succeeded',
      task: { phase: 'idle', lastError: { code: 'STALE_ERROR', message: 'Must not leak' } },
    }))).toMatchObject({ phase: 'succeeded', error: null })
    expect(resolveWorkspaceCanvasLifecycle(facts({ persistedPhase: 'failed', task: null }))).toMatchObject({
      phase: 'failed', error: null,
    })
    expect(resolveWorkspaceCanvasLifecycle(facts({
      persistedPhase: 'failed',
      task: { phase: 'idle', lastError: { code: 'RESOURCE_FAILED', message: 'Resource failed' } },
    }))).toMatchObject({ phase: 'failed', error: { code: 'RESOURCE_FAILED', message: 'Resource failed' } })
  })

  it('maps canceled and dismissed tasks to the single canceled phase', () => {
    for (const phase of ['canceled', 'dismissed'] as const) {
      expect(resolveWorkspaceCanvasLifecycle(facts({
        persistedPhase: 'succeeded',
        task: { phase, taskId: 'task-cancel', runningTaskType: 'image_panel', progress: 33 },
      }))).toEqual({
        phase: 'canceled', taskId: 'task-cancel', taskType: 'image_panel', progress: 33,
        error: null, stream: null,
      })
    }
  })

  it('exhaustively derives running, streaming, status, and legacy task projections', () => {
    const phases = ['pending', 'submitting', 'queued', 'processing', 'streaming', 'succeeded', 'failed', 'canceled'] as const
    const runningPhases = new Set(['submitting', 'queued', 'processing', 'streaming'])
    for (const phase of phases) {
      const value: WorkspaceCanvasLifecycle = {
        phase,
        taskId: phase === 'pending' ? null : 'task-1',
        taskType: 'image_panel',
        progress: 40,
        error: phase === 'failed' ? { code: 'FAILED', message: 'Failed' } : null,
        stream: phase === 'streaming' ? presentation : null,
      }
      expect(isWorkspaceCanvasLifecycleRunning(value)).toBe(runningPhases.has(phase))
      expect(isWorkspaceCanvasLifecycleStreaming(value)).toBe(phase === 'streaming')
      expect(workspaceCanvasLifecycleStatusKey(value)).toBe(
        runningPhases.has(phase) ? 'processing' : phase,
      )
      expect(workspaceCanvasLifecycleTaskState(value)).toEqual(phase === 'pending' ? null : {
        phase: phase === 'streaming' ? 'processing' : phase,
        runningTaskId: 'task-1',
        runningTaskType: 'image_panel',
        progress: 40,
        lastError: value.error,
      })
    }
  })
})
