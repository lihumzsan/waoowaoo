import { beforeEach, describe, expect, it } from 'vitest'
import {
  assertAsyncMigrationPreflightClear,
  readAsyncMigrationPreflightCounts,
} from '../../../scripts/check-async-migration-preflight'
import { TASK_TYPE } from '@/lib/task/types'
import { resetBillingState } from '../../helpers/db-reset'
import { createQueuedTask, createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { prisma } from '../../helpers/prisma'

describe('async migration preflight DB evidence', () => {
  beforeEach(async () => {
    await prisma.outboxCommand.deleteMany()
    await resetBillingState()
  })

  it('fails closed while Task or Outbox work remains and passes after drain', async () => {
    const empty = await readAsyncMigrationPreflightCounts()
    expect(empty).toEqual({
      activeTasks: 0,
      legacyStyleParentTasks: 0,
      pendingOutboxCommands: 0,
      activeAssistantRuns: 0,
      activeAssistantWaits: 0,
    })
    expect(() => assertAsyncMigrationPreflightClear(empty)).not.toThrow()

    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await createQueuedTask({
      id: 'preflight-active-task',
      userId: user.id,
      projectId: project.id,
      type: TASK_TYPE.MUSIC_GENERATE,
      targetType: 'Project',
      targetId: project.id,
      payload: { prompt: 'must drain' },
    })
    await prisma.outboxCommand.create({
      data: {
        kind: 'task.lifecycle.broadcast',
        idempotencyKey: 'preflight-pending-outbox',
        aggregateType: 'task',
        aggregateId: 'preflight-active-task',
        payload: {
          kind: 'task.lifecycle.broadcast',
          eventId: 1,
          taskId: 'preflight-active-task',
        },
      },
    })

    const blocked = await readAsyncMigrationPreflightCounts()
    expect(blocked).toMatchObject({ activeTasks: 1, pendingOutboxCommands: 1 })
    expect(() => assertAsyncMigrationPreflightClear(blocked))
      .toThrow('ASYNC_MIGRATION_PREFLIGHT_BLOCKED:activeTasks=1,pendingOutboxCommands=1')
  })
})
