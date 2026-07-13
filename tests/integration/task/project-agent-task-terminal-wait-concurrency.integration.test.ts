import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { appendProjectAgentEvents } from '@/lib/project-agent/event'
import { createProjectAgentRunFence } from '@/lib/project-agent/run-fence'
import { createProjectAgentUserTurnRun } from '@/lib/project-agent/runs'
import { bindProjectAgentWaitToTasksInTransaction } from '@/lib/project-agent/waits'
import { commitTaskTerminal } from '@/lib/task/terminal'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'

describe('Project Agent Task terminal Wait concurrency', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  afterEach(async () => {
    await resetBillingState()
  })

  it('serializes two terminal commits through the locked Wait aggregate without leaving awaiting_task stuck', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const episode = await prisma.projectEpisode.create({
      data: { projectId: project.id, episodeNumber: 1, name: 'Terminal concurrency episode' },
    })
    const { run } = await createProjectAgentUserTurnRun({
      runId: 'assistant-terminal-race-run',
      requestId: 'assistant-terminal-race-request',
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      message: {
        id: 'assistant-terminal-race-message',
        role: 'user',
        parts: [{ type: 'text', text: 'run two tasks' }],
      },
    })
    const runFence = createProjectAgentRunFence(run)
    const activityId = 'assistant-terminal-race-activity'
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
          operationId: 'concurrent_terminal_test',
        },
      }],
    })
    const taskIds = ['assistant-terminal-race-task-1', 'assistant-terminal-race-task-2']
    await prisma.task.createMany({
      data: taskIds.map((id) => ({
        id,
        userId: user.id,
        projectId: project.id,
        episodeId: episode.id,
        type: TASK_TYPE.IMAGE_PANEL,
        targetType: 'ProjectPanel',
        targetId: `${id}-target`,
        status: TASK_STATUS.QUEUED,
        payload: {},
      })),
    })
    const suspension = await prisma.$transaction(async (tx) => await bindProjectAgentWaitToTasksInTransaction(tx, {
      runFence,
      runId: run.id,
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      operationId: 'concurrent_terminal_test',
      taskIds,
      followUpMode: 'resume_agent',
      sourceOperationActivityId: activityId,
    }))
    if (!suspension) throw new Error('EXPECTED_WAIT')
    const waitId = suspension.waitId

    const results = await Promise.all(taskIds.map(async (taskId) => await commitTaskTerminal({
      kind: 'failed',
      taskId,
      fence: { kind: 'active' },
      errorCode: 'CONCURRENT_TERMINAL_TEST',
      errorMessage: `${taskId} failed`,
      source: 'validation',
    })))

    expect(results).toEqual([
      expect.objectContaining({ applied: true, status: 'failed' }),
      expect.objectContaining({ applied: true, status: 'failed' }),
    ])
    const [wait, storedRun, continuationCommands] = await Promise.all([
      prisma.projectAgentWait.findUniqueOrThrow({ where: { id: waitId } }),
      prisma.projectAgentRun.findUniqueOrThrow({ where: { id: run.id } }),
      prisma.outboxCommand.findMany({
        where: { kind: 'project_agent.continue_wait', aggregateId: waitId },
      }),
    ])
    expect(wait).toMatchObject({ status: 'resolved', terminalStatus: 'failed' })
    expect((wait.terminalTaskIds as string[]).sort()).toEqual([...taskIds].sort())
    expect((wait.failedTaskIds as string[]).sort()).toEqual([...taskIds].sort())
    expect(storedRun.status).toBe('awaiting_task')
    expect(continuationCommands).toHaveLength(1)
  })
})
