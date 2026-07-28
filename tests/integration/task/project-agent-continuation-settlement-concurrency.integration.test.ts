import { beforeEach, describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import {
  claimProjectAgentWaitContinuation,
} from '@/lib/project-agent/waits'
import {
  appendProjectAssistantThreadMessages,
  loadProjectAssistantThread,
} from '@/lib/project-agent/persistence'
import {
  createProjectAgentUserTurnRun,
  settleProjectAgentRunWithMessage,
} from '@/lib/project-agent/runs'
import { resolveProjectAgentWaitsForTaskTerminalInTransaction } from '@/lib/project-agent/waits'
import { createQueuedTask } from '../../helpers/billing-fixtures'
import { TASK_EVENT_TYPE, TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
const RUN_ID = 'continuation-run-1'
const WAIT_ID = 'continuation-wait-1'
const COMMAND_ID = 'continuation-command-1'
const FIRST_CLAIM = 'continuation-claim-1'
async function seedClaimedContinuation() {
  const user = await createTestUser()
  const project = await createTestProject(user.id)
  await createQueuedTask({
    id: 'task-1',
    userId: user.id,
    projectId: project.id,
    type: TASK_TYPE.CREATIVE_RESOURCE_VIDEO,
    targetType: 'CreativeResource',
    targetId: 'continuation-video-resource-1',
    payload: {},
  })
  await prisma.task.update({
    where: { id: 'task-1' },
    data: {
      status: TASK_STATUS.COMPLETED,
      progress: 100,
      result: { continuationProjection: { resources: [] } },
      finishedAt: new Date(),
    },
  })
  await prisma.projectAgentRun.create({
    data: {
      id: RUN_ID,
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      scopeRef: `project:${project.id}`,
      requestId: COMMAND_ID,
      status: 'running',
      runVersion: 1,
      eventSeq: BigInt(0),
      controlKind: 'task_follow_up',
    },
  })
  await prisma.projectAgentActivity.create({
    data: {
      id: COMMAND_ID,
      runId: RUN_ID,
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      scopeRef: `project:${project.id}`,
      type: 'task_follow_up',
      status: 'running',
      sourceOperationId: 'create_video',
    },
  })
  await prisma.projectAgentWait.create({
    data: {
      id: WAIT_ID,
      runId: RUN_ID,
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      scopeRef: `project:${project.id}`,
      operationId: 'create_video',
      taskIds: ['task-1'],
      followUpMode: 'resume_agent',
      status: 'claimed',
      runVersion: 1,
      eventSeq: BigInt(0),
      terminalStatus: 'completed',
      terminalTaskIds: ['task-1'],
      failedTaskIds: [],
      canceledTaskIds: [],
      followUpKey: `project-agent-wait:${WAIT_ID}:completed`,
      followUpCommandId: COMMAND_ID,
      claimId: FIRST_CLAIM,
      claimedAt: new Date(),
      claimExpiresAt: new Date(Date.now() + 60_000),
      resolvedAt: new Date(),
    },
  })
  return { user, project }
}
function buildAssistantMessage(): UIMessage {
  return {
    id: `workspace-assistant-task-follow-up:${WAIT_ID}:${COMMAND_ID}`,
    role: 'assistant',
    parts: [{ type: 'text', text: '任务已经完成。' }],
  }
}
describe('Project Agent continuation settlement DB integration', () => {
  beforeEach(async () => {
    await resetBillingState()
  })
  it('grants exactly one owner when two workers concurrently claim the same resolved Wait', async () => {
    await seedClaimedContinuation()
    await prisma.projectAgentWait.update({
      where: { id: WAIT_ID },
      data: {
        status: 'resolved',
        claimId: null,
        claimedAt: null,
        claimExpiresAt: null,
      },
    })

    const claims = await Promise.all([
      claimProjectAgentWaitContinuation({
        waitId: WAIT_ID,
        runId: RUN_ID,
        expectedRunVersion: 1,
        expectedEventSeq: '0',
        commandId: COMMAND_ID,
        claimOwner: 'competing-owner-a',
      }),
      claimProjectAgentWaitContinuation({
        waitId: WAIT_ID,
        runId: RUN_ID,
        expectedRunVersion: 1,
        expectedEventSeq: '0',
        commandId: COMMAND_ID,
        claimOwner: 'competing-owner-b',
      }),
    ])

    expect(claims.filter((claim) => claim.status === 'claimed')).toHaveLength(1)
    expect(claims.filter((claim) => claim.status !== 'claimed')).toHaveLength(1)
    const wait = await prisma.projectAgentWait.findUniqueOrThrow({ where: { id: WAIT_ID } })
    const winningClaim = claims.find((claim) => claim.status === 'claimed')
    expect(wait.status).toBe('claimed')
    expect(wait.claimId).toBe(winningClaim?.status === 'claimed' ? winningClaim.followUp.claimId : null)
    expect(await prisma.projectAgentActivity.count({ where: { runId: RUN_ID } })).toBe(1)
  })
  it('rejects a conflicting replay of a persisted terminal message id', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const message: UIMessage = {
      id: 'terminal-message-id',
      role: 'assistant',
      parts: [{ type: 'text', text: 'authoritative terminal response' }],
    }
    await appendProjectAssistantThreadMessages({
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      messages: [message],
    })
    await expect(appendProjectAssistantThreadMessages({
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      messages: [{
        ...message,
        parts: [{ type: 'text', text: 'conflicting replay' }],
      }],
    })).rejects.toThrow('PROJECT_ASSISTANT_MESSAGE_ID_CONFLICT:terminal-message-id')
    const thread = await loadProjectAssistantThread({
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
    })
    expect(thread?.messages).toEqual([message])
  })
  it('rolls back the assistant message when the Run terminal fence is stale', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await prisma.projectAgentRun.create({
      data: {
        id: 'run-message-settlement-1',
        projectId: project.id,
        userId: user.id,
        assistantId: 'workspace-command',
        scopeRef: `project:${project.id}`,
        requestId: 'request-message-settlement-1',
        status: 'running',
        runVersion: 1,
        eventSeq: BigInt(0),
        controlKind: 'user_turn',
      },
    })
    const message: UIMessage = {
      id: 'assistant-terminal-message-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'done' }],
    }
    await expect(settleProjectAgentRunWithMessage({
      runFence: { runId: 'run-message-settlement-1', runVersion: 0, eventSeq: '0' },
      status: 'completed',
      stopReason: 'completed',
      message,
    })).rejects.toThrow()
    const [run, thread] = await Promise.all([
      prisma.projectAgentRun.findUnique({ where: { id: 'run-message-settlement-1' } }),
      loadProjectAssistantThread({
        projectId: project.id,
        userId: user.id,
        assistantId: 'workspace-command',
      }),
    ])
    expect(run?.status).toBe('running')
    expect(thread).toBeNull()
  })
  /**
   * Authority: a user turn owns only the foreground Run slot; background Task
   * Runs remain independent and still schedule their terminal continuation.
   * Rejects: treating an awaiting-task Run as the current conversation and
   * canceling its Wait when the user sends another message.
   */
  it('keeps an awaiting-task Wait alive when a new foreground user turn starts', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const runId = 'superseded-awaiting-task-run'
    const activityId = 'superseded-awaiting-task-activity'
    const waitId = 'superseded-awaiting-task-wait'
    const taskId = 'superseded-awaiting-task-task'
    await prisma.projectAgentRun.create({
      data: {
        id: runId,
        projectId: project.id,
        userId: user.id,
        assistantId: 'workspace-command',
        scopeRef: `project:${project.id}`,
        requestId: 'superseded-awaiting-task-request',
        status: 'awaiting_task',
        runVersion: 1,
        eventSeq: BigInt(0),
        controlKind: 'task_follow_up',
      },
    })
    await prisma.projectAgentActivity.create({
      data: {
        id: activityId,
        runId,
        projectId: project.id,
        userId: user.id,
        assistantId: 'workspace-command',
        scopeRef: `project:${project.id}`,
        type: 'waiting_task',
        status: 'waiting',
        operationId: 'delegate_creative_work',
      },
    })
    await createQueuedTask({
      id: taskId,
      userId: user.id,
      projectId: project.id,
      type: TASK_TYPE.CREATIVE_WORK,
      targetType: 'CreativeWork',
      targetId: 'superseded-creative-work',
      operationId: 'delegate_creative_work',
    })
    await prisma.projectAgentWait.create({
      data: {
        id: waitId,
        runId,
        activityId,
        projectId: project.id,
        userId: user.id,
        assistantId: 'workspace-command',
        scopeRef: `project:${project.id}`,
        operationId: 'delegate_creative_work',
        taskIds: [taskId],
        status: 'pending',
        runVersion: 1,
        eventSeq: BigInt(0),
      },
    })
    const replacement = await createProjectAgentUserTurnRun({
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      runId: 'replacement-user-turn-run',
      requestId: 'replacement-user-turn-request',
      message: {
        id: 'replacement-user-message',
        role: 'user',
        parts: [{ type: 'text', text: 'Start a new turn instead.' }],
      },
    })
    expect(replacement.declinedInterruptions).toEqual([])
    expect(replacement.run).toMatchObject({ id: 'replacement-user-turn-run', status: 'running' })
    await prisma.task.update({
      where: { id: taskId },
      data: { status: TASK_STATUS.COMPLETED, finishedAt: new Date() },
    })
    await expect(prisma.$transaction(async (tx) => (
      await resolveProjectAgentWaitsForTaskTerminalInTransaction(tx, {
        taskId,
        projectId: project.id,
        userId: user.id,
        lifecycleType: TASK_EVENT_TYPE.COMPLETED,
      })
    ))).resolves.toEqual([expect.any(String)])
    const [run, activity, wait, continuationCommands, replacementThread] = await Promise.all([
      prisma.projectAgentRun.findUnique({ where: { id: runId } }),
      prisma.projectAgentActivity.findUnique({ where: { id: activityId } }),
      prisma.projectAgentWait.findUnique({ where: { id: waitId } }),
      prisma.outboxCommand.count({
        where: {
          aggregateType: 'project_agent_wait',
          aggregateId: waitId,
        },
      }),
      loadProjectAssistantThread({
        projectId: project.id,
        userId: user.id,
        assistantId: 'workspace-command',
      }),
    ])
    expect(run?.status).toBe('awaiting_task')
    expect(activity?.status).toBe('completed')
    expect(wait).toMatchObject({
      status: 'resolved',
      terminalStatus: 'completed',
      terminalTaskIds: [taskId],
      followedAt: null,
    })
    expect(continuationCommands).toBe(1)
    expect(replacementThread?.messages.map((message) => message.id)).toContain('replacement-user-message')
  })
})
