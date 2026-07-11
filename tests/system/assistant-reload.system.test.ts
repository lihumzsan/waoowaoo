import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
import { createProjectAgentRun } from '@/lib/project-agent/runs'
import { bindProjectAgentWaitToTasksInTransaction } from '@/lib/project-agent/waits'
import { getProjectAgentSessionState } from '@/lib/project-agent/session-state'
import { settleProjectAgentInterruptionSuspension } from '@/lib/project-agent/interruptions'
import { fingerprintProjectAgentChoiceResource } from '@/lib/project-agent/choice-offer'
import { appendProjectAssistantThreadMessages } from '@/lib/project-agent/persistence'
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
    const wait = await prisma.$transaction(async (tx) => bindProjectAgentWaitToTasksInTransaction(tx, {
      projectId: seeded.project.id,
      userId: seeded.user.id,
      episodeId: seeded.episode.id,
      runId: run.id,
      runFence: { runId: run.id, runVersion: run.runVersion, eventSeq: run.eventSeq },
      operationId: 'generate_character_image',
      taskIds: [task.id],
      followUpMode: 'resume_agent',
    }))
    expect(wait?.waitId).toEqual(expect.any(String))
    if (!wait) throw new Error('SYSTEM_ASSISTANT_WAIT_RECEIPT_MISSING')
    const waitId = wait.waitId

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

  it('[P0:SYS-ASSISTANT-AWAITING-CHOICE-RELOAD] rebuilds the durable assistant reply and its pending Choice after module reload', async () => {
    const seeded = await seedMinimalDomainState()
    const run = await createProjectAgentRun({
      projectId: seeded.project.id,
      userId: seeded.user.id,
      episodeId: seeded.episode.id,
      requestId: `system-choice-reload:${seeded.project.id}`,
      controlKind: 'user_turn',
    })
    const suspension = await settleProjectAgentInterruptionSuspension({
      kind: 'choice',
      executionFence: {
        runFence: { runId: run.id, runVersion: run.runVersion, eventSeq: run.eventSeq },
        signal: new AbortController().signal,
      },
      projectId: seeded.project.id,
      userId: seeded.user.id,
      episodeId: seeded.episode.id,
      assistantId: 'workspace-command',
      runId: run.id,
      runFence: { runId: run.id, runVersion: run.runVersion, eventSeq: run.eventSeq },
      operationId: 'request_script_intake_choice',
      toolCallId: `system-choice-tool:${run.id}`,
      card: {
        cardId: `system-choice-card:${run.id}`,
        toolCallId: `system-choice-tool:${run.id}`,
        choiceType: 'script_intake',
        replyMode: 'per_group',
        title: '补充创作方向',
        description: '请选择创作方向。',
        groups: [],
        submitLabel: '继续',
        submit: { kind: 'submit_tool_output', decision: 'approve' },
      },
      reviewedResource: fingerprintProjectAgentChoiceResource({
        kind: 'script_intake_prompt',
        snapshot: {
          cardId: `system-choice-card:${run.id}`,
          choiceType: 'script_intake',
          groups: [],
        },
      }),
    })
    if (suspension.kind !== 'choice') throw new Error('SYSTEM_ASSISTANT_CHOICE_SUSPENSION_INVALID')
    await appendProjectAssistantThreadMessages({
      projectId: seeded.project.id,
      userId: seeded.user.id,
      episodeId: seeded.episode.id,
      assistantId: 'workspace-command',
      messages: [{
        id: `system-choice-message:${run.id}`,
        role: 'assistant',
        parts: [
          { type: 'text', text: '请先补充几个创作方向。' },
          { type: 'data-assistant-choice-card', data: suspension.card },
        ],
      }],
    })

    const first = await getProjectAgentSessionState({
      projectId: seeded.project.id,
      userId: seeded.user.id,
      episodeId: seeded.episode.id,
      assistantId: 'workspace-command',
      locale: 'zh',
    })
    vi.resetModules()
    const reloadedSession = await import('@/lib/project-agent/session-state')
    const reloadedThread = await import('@/lib/project-agent/thread-snapshot')
    const [reloaded, snapshot] = await Promise.all([
      reloadedSession.getProjectAgentSessionState({
        projectId: seeded.project.id,
        userId: seeded.user.id,
        episodeId: seeded.episode.id,
        assistantId: 'workspace-command',
        locale: 'zh',
      }),
      reloadedThread.getProjectAssistantThreadWatermarkedSnapshot({
        projectId: seeded.project.id,
        userId: seeded.user.id,
        episodeId: seeded.episode.id,
        assistantId: 'workspace-command',
      }),
    ])

    expect(reloaded.currentRun).toEqual(first.currentRun)
    expect(reloaded.currentRun).toMatchObject({ runId: run.id, status: 'awaiting_choice' })
    expect(reloaded.pendingInteraction).toMatchObject({
      kind: 'choice',
      runId: run.id,
      interruptionId: suspension.card.interruptionId,
      operationId: 'request_script_intake_choice',
      choiceType: 'script_intake',
    })
    expect(snapshot.thread?.messages).toEqual([expect.objectContaining({
      id: `system-choice-message:${run.id}`,
      parts: expect.arrayContaining([
        expect.objectContaining({ type: 'text', text: '请先补充几个创作方向。' }),
        expect.objectContaining({ type: 'data-assistant-choice-card', data: expect.objectContaining({
          interruptionId: suspension.card.interruptionId,
        }) }),
      ]),
    })])
  })

  it('rejects two persisted active Runs instead of selecting one', async () => {
    const seeded = await seedMinimalDomainState()
    const scopeRef = `episode:${seeded.episode.id}`
    await prisma.projectAgentRun.createMany({
      data: [
        {
          projectId: seeded.project.id,
          userId: seeded.user.id,
          episodeId: seeded.episode.id,
          assistantId: 'workspace-command',
          scopeRef,
          requestId: `system-conflict-a:${seeded.project.id}`,
          status: 'running',
          controlKind: 'user_turn',
        },
        {
          projectId: seeded.project.id,
          userId: seeded.user.id,
          episodeId: seeded.episode.id,
          assistantId: 'workspace-command',
          scopeRef,
          requestId: `system-conflict-b:${seeded.project.id}`,
          status: 'awaiting_task',
          controlKind: 'approval_response',
        },
      ],
    })

    await expect(getProjectAgentSessionState({
      projectId: seeded.project.id,
      userId: seeded.user.id,
      episodeId: seeded.episode.id,
      assistantId: 'workspace-command',
      locale: 'zh',
    })).rejects.toThrow('PROJECT_AGENT_SESSION_ACTIVE_RUN_CONFLICT')
  })

  it('rejects an open Activity owned by a different Run', async () => {
    const seeded = await seedMinimalDomainState()
    const activeRun = await createProjectAgentRun({
      projectId: seeded.project.id,
      userId: seeded.user.id,
      episodeId: seeded.episode.id,
      requestId: `system-active:${seeded.project.id}`,
      controlKind: 'user_turn',
    })
    const foreignRun = await prisma.projectAgentRun.create({
      data: {
        projectId: seeded.project.id,
        userId: seeded.user.id,
        episodeId: seeded.episode.id,
        assistantId: 'workspace-command',
        scopeRef: `episode:${seeded.episode.id}`,
        requestId: `system-foreign:${seeded.project.id}`,
        status: 'completed',
        controlKind: 'user_turn',
      },
    })
    const foreignActivity = await prisma.projectAgentActivity.create({
      data: {
        runId: foreignRun.id,
        projectId: seeded.project.id,
        userId: seeded.user.id,
        episodeId: seeded.episode.id,
        assistantId: 'workspace-command',
        scopeRef: `episode:${seeded.episode.id}`,
        type: 'operation',
        status: 'running',
        operationId: 'generate_character_image',
      },
    })

    await expect(getProjectAgentSessionState({
      projectId: seeded.project.id,
      userId: seeded.user.id,
      episodeId: seeded.episode.id,
      assistantId: 'workspace-command',
      locale: 'zh',
    })).rejects.toThrow(
      `PROJECT_AGENT_SESSION_ACTIVITY_RUN_MISMATCH:${foreignActivity.id}:${foreignRun.id}:${activeRun.id}`,
    )
  })
})
