import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NextRequest } from 'next/server'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { createProjectAgentUserTurnRun } from '@/lib/project-agent/runs'
import { appendProjectAgentEvents } from '@/lib/project-agent/event'
import { createProjectAgentRunFence } from '@/lib/project-agent/run-fence'
import { bindProjectAgentWaitToTasksInTransaction } from '@/lib/project-agent/waits'
import { runWithProjectAgentOperationExecutionFence } from '@/lib/project-agent/operation-execution-fence'
import { submitOperationTaskBatch } from '@/lib/operations/submit-operation-task'
import type { ProjectAgentOperationTaskBatchBinding } from '@/lib/operations/types'
import type { ProjectAgentTaskSuspensionReceipt } from '@/lib/project-agent/suspension'
import { TASK_TYPE } from '@/lib/task/types'

describe('Project Agent non-billable Task batch to Wait DB integration', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  afterEach(async () => {
    await resetBillingState()
  })

  it('commits every Task and one Run-level Wait under the same transaction', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const episode = await prisma.projectEpisode.create({
      data: { projectId: project.id, episodeNumber: 1, name: 'Assistant batch render episode' },
    })
    const chapters = await Promise.all([0, 1].map(async (chapterIndex) => await prisma.projectEditChapter.create({
      data: { episodeId: episode.id, chapterIndex },
    })))
    const { run } = await createProjectAgentUserTurnRun({
      runId: 'assistant-nonbillable-batch-run',
      requestId: 'assistant-nonbillable-batch-request',
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      message: {
        id: 'assistant-nonbillable-batch-message',
        role: 'user',
        parts: [{ type: 'text', text: 'render chapters' }],
      },
    })
    const runFence = createProjectAgentRunFence(run)
    const activityId = 'assistant-nonbillable-batch-activity'
    await appendProjectAgentEvents({
      scope: { projectId: project.id, userId: user.id, assistantId: 'workspace-command' },
      events: [{
        runFence,
        idempotencyKey: `activity-started:${activityId}`,
        event: {
          kind: 'activity.started',
          runId: run.id,
          activityId,
          type: 'operation',
          operationId: 'render_chapters',
        },
      }],
    })
    let bound = false
    let committed = false
    let committedSuspension: ProjectAgentTaskSuspensionReceipt | null = null
    const binding: ProjectAgentOperationTaskBatchBinding = {
      async bindInTransaction(tx, batch) {
        const suspension = await bindProjectAgentWaitToTasksInTransaction(tx, {
          runFence,
          runId: run.id,
          projectId: project.id,
          userId: user.id,
          assistantId: 'workspace-command',
          operationId: batch.operationId,
          taskIds: [...batch.taskIds],
          followUpMode: 'resume_agent',
          sourceOperationActivityId: activityId,
        })
        if (!suspension) throw new Error('EXPECTED_WAIT')
        bound = true
        committedSuspension = suspension
        return suspension
      },
      isBound: () => bound,
      markCommitted: () => { committed = bound },
      isCommitted: () => committed,
      getCommittedSuspension: () => committed ? committedSuspension : null,
    }
    const request = new Request('http://localhost', {
      headers: { 'x-request-id': 'assistant-nonbillable-batch-request' },
    }) as NextRequest
    const results = await runWithProjectAgentOperationExecutionFence({
      runFence,
      signal: new AbortController().signal,
      taskBatchBinding: binding,
    }, async () => await submitOperationTaskBatch(chapters.map((chapter) => ({
      request,
      userId: user.id,
      projectId: project.id,
      episodeId: episode.id,
      type: TASK_TYPE.CHAPTER_RENDER,
      targetType: 'ProjectEditChapter',
      targetId: chapter.id,
      operationId: 'render_chapters',
      source: 'assistant-panel',
      payload: { episodeId: episode.id, chapterId: chapter.id },
      dedupeKey: `assistant-nonbillable-batch:${chapter.id}`,
      locale: 'en' as const,
      billingInfo: null,
    }))))

    const [storedRun, waits, tasks, enqueueCommands] = await Promise.all([
      prisma.projectAgentRun.findUniqueOrThrow({ where: { id: run.id } }),
      prisma.projectAgentWait.findMany({ where: { runId: run.id } }),
      prisma.task.findMany({ where: { id: { in: results.map((result) => result.taskId) } } }),
      prisma.outboxCommand.findMany({
        where: { kind: 'task.enqueue', aggregateId: { in: results.map((result) => result.taskId) } },
      }),
    ])
    expect(binding.isCommitted()).toBe(true)
    expect(storedRun.status).toBe('awaiting_task')
    expect(waits).toHaveLength(1)
    expect((waits[0]?.taskIds as string[]).sort()).toEqual(results.map((result) => result.taskId).sort())
    expect(tasks).toHaveLength(2)
    expect(enqueueCommands).toHaveLength(2)
  })
})
