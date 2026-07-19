import { beforeEach, describe, expect, it } from 'vitest'
import { AI_PROMPT_IDS } from '@/lib/ai-prompts/ids'
import {
  listTaskStructuredStreamCheckpointEvents,
  publishTaskStreamEvent,
} from '@/lib/task/publisher'
import {
  TASK_STRUCTURED_STREAM_CHECKPOINT_EVENT_TYPE,
  buildRecoverableStructuredStreamCheckpointEvents,
} from '@/lib/task/structured-stream-checkpoint'
import { TASK_TYPE } from '@/lib/task/types'
import { resetBillingState } from '../../helpers/db-reset'
import {
  createQueuedTask,
  createTestProject,
  createTestUser,
} from '../../helpers/billing-fixtures'
import { prisma } from '../../helpers/prisma'

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/**
 * Critical oracle: the production publisher and real MySQL TaskEvent owner keep
 * exactly one row per stream identity and recovery returns its latest absolute
 * payload. This rejects append-only checkpoints, stale upserts, and non-scoped
 * reads. Canonical command: npm run test:critical:task.
 */
describe('structured stream checkpoint MySQL integration', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  it('upserts one latest checkpoint and exposes it through the scoped recovery reader', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const task = await createQueuedTask({
      id: 'structured-stream-checkpoint-task',
      userId: user.id,
      projectId: project.id,
      type: TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE,
      targetType: 'ProjectEditSourceScript',
      targetId: 'source-script-1',
    })
    const basePayload = {
      stepId: AI_PROMPT_IDS.EDIT_BIBLE_OUTLINE_SCRIPT,
      stepAttempt: 1,
      streamRunId: 'stream-run-1',
    }

    await publishTaskStreamEvent({
      taskId: task.id,
      projectId: project.id,
      userId: user.id,
      taskType: task.type,
      targetType: task.targetType,
      targetId: task.targetId,
      payload: {
        ...basePayload,
        stream: { kind: 'text', lane: 'main', seq: 1, delta: '{"segments":[' },
      },
      checkpoint: { fullDelta: '{"segments":[', throughSeq: 1 },
    })
    await publishTaskStreamEvent({
      taskId: task.id,
      projectId: project.id,
      userId: user.id,
      taskType: task.type,
      targetType: task.targetType,
      targetId: task.targetId,
      payload: {
        ...basePayload,
        stream: { kind: 'text', lane: 'main', seq: 2, delta: ']}' },
      },
      checkpoint: { fullDelta: '{"segments":[]}', throughSeq: 2 },
    })

    await expect(prisma.taskEvent.count({
      where: {
        taskId: task.id,
        eventType: TASK_STRUCTURED_STREAM_CHECKPOINT_EVENT_TYPE,
      },
    })).resolves.toBe(1)

    const rows = await listTaskStructuredStreamCheckpointEvents({
      projectId: project.id,
      userId: user.id,
      taskIds: [task.id],
    })
    const [checkpoint] = buildRecoverableStructuredStreamCheckpointEvents(rows)
    const payload = readRecord(checkpoint?.payload)
    expect(readRecord(payload.stream)).toMatchObject({
      kind: 'text',
      lane: 'main',
      seq: 2,
      delta: '{"segments":[]}',
    })
    expect(readRecord(payload.streamCheckpoint)).toMatchObject({ fromSeq: 1, throughSeq: 2 })

    const otherUser = await createTestUser()
    await expect(listTaskStructuredStreamCheckpointEvents({
      projectId: project.id,
      userId: otherUser.id,
      taskIds: [task.id],
    })).resolves.toEqual([])
  })
})
