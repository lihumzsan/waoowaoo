import { beforeEach, describe, expect, it } from 'vitest'
import {
  tryClaimTaskAttempt,
  tryMarkTaskQueuedForRetry,
} from '@/lib/task/service'
import { TASK_TYPE } from '@/lib/task/types'
import { resetBillingState } from '../../helpers/db-reset'
import {
  createQueuedTask,
  createTestProject,
  createTestUser,
} from '../../helpers/billing-fixtures'
import { prisma } from '../../helpers/prisma'

describe('task attempt ownership MySQL integration', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  it('allows only one concurrent worker to claim each exact attempt', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const task = await createQueuedTask({
      id: 'attempt-owner-task',
      userId: user.id,
      projectId: project.id,
      type: TASK_TYPE.MUSIC_GENERATE,
      targetType: 'Project',
      targetId: project.id,
    })

    const firstClaims = await Promise.all(Array.from({ length: 8 }, async () =>
      await tryClaimTaskAttempt({ taskId: task.id })))
    expect(firstClaims.filter((attempt) => attempt === 1)).toHaveLength(1)
    await expect(prisma.task.findUniqueOrThrow({
      where: { id: task.id },
      select: { status: true, attempt: true },
    })).resolves.toEqual({ status: 'processing', attempt: 1 })

    await expect(tryMarkTaskQueuedForRetry(task.id, 1)).resolves.toBe(true)
    await expect(tryMarkTaskQueuedForRetry(task.id, 1)).resolves.toBe(false)

    const secondClaims = await Promise.all(Array.from({ length: 8 }, async () =>
      await tryClaimTaskAttempt({ taskId: task.id })))
    expect(secondClaims.filter((attempt) => attempt === 2)).toHaveLength(1)
    await expect(prisma.task.findUniqueOrThrow({
      where: { id: task.id },
      select: { status: true, attempt: true },
    })).resolves.toEqual({ status: 'processing', attempt: 2 })

    await expect(tryClaimTaskAttempt({ taskId: task.id })).resolves.toBeNull()
  })
})
