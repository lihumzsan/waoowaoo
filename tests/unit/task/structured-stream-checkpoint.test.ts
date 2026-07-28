import { describe, expect, it } from 'vitest'
import {
  buildRecoverableStructuredStreamCheckpointEvents,
  buildStructuredStreamTerminalSnapshotEvents,
  buildTaskStructuredStreamCheckpoint,
} from '@/lib/task/structured-stream-checkpoint'
import {
  TASK_EVENT_TYPE,
  TASK_SSE_EVENT_TYPE,
  TASK_TYPE,
  type TaskSSEEvent,
} from '@/lib/task/types'

/**
 * Logic Specification
 * Authority: TL-06A/TL-09 and CN-02B structured-stream recovery protocol.
 * Rejects: caller-selected persistence, stale retry runs, cursor-rejected numeric recovery events,
 * and a completed checkpoint without a recoverable terminal marker.
 * Production entry: Task stream publisher and get_sse_bootstrap recovery snapshot.
 * Oracle: the shared adapter registry selects persistence; one logical lane returns its newest
 * absolute checkpoint with a synthetic identity, followed by the same Task's terminal snapshot.
 * Command: npx vitest run tests/unit/task/structured-stream-checkpoint.test.ts
 */

function checkpointEvent(input: {
  id: string
  taskId?: string
  streamRunId: string
  stepAttempt: number
  throughSeq: number
  checkpointedAt: string
}): TaskSSEEvent {
  return {
    id: input.id,
    type: TASK_SSE_EVENT_TYPE.STREAM,
    taskId: input.taskId ?? 'task-1',
    projectId: 'project-1',
    userId: 'user-1',
    ts: '2026-07-19T00:00:00.000Z',
    taskType: TASK_TYPE.CREATIVE_WORK,
    targetType: 'Project',
    targetId: 'project-1',
    episodeId: 'episode-1',
    payload: {
      stepId: 'creative-work-output',
      stepAttempt: input.stepAttempt,
      streamRunId: input.streamRunId,
      stream: {
        kind: 'text',
        lane: 'main',
        seq: input.throughSeq,
        delta: '{"segments":[]}',
      },
      streamCheckpoint: {
        fromSeq: 1,
        throughSeq: input.throughSeq,
        checkpointedAt: input.checkpointedAt,
      },
    },
  }
}

describe('Task structured-stream checkpoint protocol', () => {
  it('does not persist presentation checkpoints without a registered adapter', () => {
    const input = {
      taskId: 'task-1',
      taskType: TASK_TYPE.CREATIVE_WORK,
      payload: {
        stepId: '1:structured-output',
        stepAttempt: 1,
        streamRunId: 'run-1',
        stream: { kind: 'text', lane: 'structured-output', seq: 2, delta: 'tail' },
      },
      checkpoint: { fullDelta: '{"segments":[]}', throughSeq: 2 },
      checkpointedAt: '2026-07-19T00:00:02.000Z',
    } as const

    expect(buildTaskStructuredStreamCheckpoint(input)).toBeNull()
  })

  it('selects the newest run per logical lane and emits non-cursor recovery identities', () => {
    const checkpoints = buildRecoverableStructuredStreamCheckpointEvents([
      checkpointEvent({
        id: '10',
        streamRunId: 'run-old',
        stepAttempt: 1,
        throughSeq: 8,
        checkpointedAt: '2026-07-19T00:00:01.000Z',
      }),
      checkpointEvent({
        id: '11',
        streamRunId: 'run-current',
        stepAttempt: 1,
        throughSeq: 3,
        checkpointedAt: '2026-07-19T00:00:02.000Z',
      }),
    ])

    expect(checkpoints).toHaveLength(1)
    expect(checkpoints[0]).toMatchObject({
      id: 'snapshot:stream:11:3',
      taskId: 'task-1',
      ts: '2026-07-19T00:00:02.000Z',
      payload: { streamRunId: 'run-current' },
    })
  })

  it('pairs a recovered completed stream with the same Task terminal snapshot', () => {
    const [checkpoint] = buildRecoverableStructuredStreamCheckpointEvents([
      checkpointEvent({
        id: '11',
        streamRunId: 'run-current',
        stepAttempt: 1,
        throughSeq: 3,
        checkpointedAt: '2026-07-19T00:00:02.000Z',
      }),
    ])
    const terminal: TaskSSEEvent = {
      ...checkpointEvent({
        id: '12',
        streamRunId: 'run-current',
        stepAttempt: 1,
        throughSeq: 3,
        checkpointedAt: '2026-07-19T00:00:02.000Z',
      }),
      type: TASK_SSE_EVENT_TYPE.LIFECYCLE,
      ts: '2026-07-19T00:00:03.000Z',
      payload: { lifecycleType: TASK_EVENT_TYPE.COMPLETED },
    }

    const terminalSnapshots = buildStructuredStreamTerminalSnapshotEvents({
      checkpoints: checkpoint ? [checkpoint] : [],
      terminalEvents: [terminal],
    })

    expect(terminalSnapshots).toEqual([{
      ...terminal,
      id: 'snapshot:terminal:task-1:12',
    }])
  })
})
