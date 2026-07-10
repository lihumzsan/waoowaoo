import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
import { createProjectAgentRun } from '@/lib/project-agent/runs'
import { createProjectAgentWait } from '@/lib/project-agent/waits'
import { resetSystemState } from '../helpers/db-reset'
import { prisma } from '../helpers/prisma'
import { seedMinimalDomainState } from './helpers/seed'

describe('system - Assistant awaiting-task reload', () => {
  beforeEach(async () => {
    await resetSystemState()
  })

  it('[P0:SYS-ASSISTANT-AWAITING-TASK-RELOAD] rebuilds Run, Activity, Wait, and active Task from persistence after module reload', async () => {
    const seeded = await seedMinimalDomainState()
    const run = await createProjectAgentRun({
      projectId: seeded.project.id,
      userId: seeded.user.id,
      episodeId: seeded.episode.id,
      requestId: `system-reload:${seeded.project.id}`,
      controlKind: 'approval_response',
    })
    const task = await prisma.task.create({
      data: {
        userId: seeded.user.id,
        projectId: seeded.project.id,
        episodeId: seeded.episode.id,
        type: TASK_TYPE.IMAGE_CHARACTER,
        targetType: 'CharacterAppearance',
        targetId: seeded.appearance.id,
        operationId: 'generate_character_image',
        operationSource: 'assistant-panel',
        status: TASK_STATUS.QUEUED,
        payload: { meta: { locale: 'zh' } },
        queuedAt: new Date(),
        enqueuedAt: new Date(),
      },
    })
    const waitId = await createProjectAgentWait({
      projectId: seeded.project.id,
      userId: seeded.user.id,
      episodeId: seeded.episode.id,
      runId: run.id,
      runFence: { runId: run.id, runVersion: run.runVersion, eventSeq: run.eventSeq },
      operationId: 'generate_character_image',
      taskIds: [task.id],
      followUpMode: 'resume_agent',
    })
    expect(waitId).toEqual(expect.any(String))

    const firstModule = await import('@/lib/project-agent/session-state')
    const first = await firstModule.getProjectAgentSessionState({
      projectId: seeded.project.id,
      userId: seeded.user.id,
      episodeId: seeded.episode.id,
      assistantId: 'workspace-command',
      locale: 'zh',
    })
    vi.resetModules()
    const reloadedModule = await import('@/lib/project-agent/session-state')
    const reloaded = await reloadedModule.getProjectAgentSessionState({
      projectId: seeded.project.id,
      userId: seeded.user.id,
      episodeId: seeded.episode.id,
      assistantId: 'workspace-command',
      locale: 'zh',
    })

    expect(reloaded.currentRun).toEqual(first.currentRun)
    expect(reloaded.currentRun).toMatchObject({
      runId: run.id,
      status: 'awaiting_task',
      controlKind: 'approval_response',
    })
    expect(reloaded.currentActivity).toMatchObject({
      runId: run.id,
      type: 'waiting_task',
      status: 'waiting',
      operationId: 'generate_character_image',
    })
    expect(reloaded.activeWaits).toEqual([
      expect.objectContaining({
        runId: run.id,
        waitId,
        status: 'pending',
        taskIds: [task.id],
      }),
    ])
    expect(reloaded.activeTasks).toEqual([{
      taskId: task.id,
      operationId: 'generate_character_image',
      taskType: TASK_TYPE.IMAGE_CHARACTER,
      targetType: 'CharacterAppearance',
      targetId: seeded.appearance.id,
      status: TASK_STATUS.QUEUED,
    }])
    expect(reloaded.pendingInteraction).toBeNull()
  })
})
