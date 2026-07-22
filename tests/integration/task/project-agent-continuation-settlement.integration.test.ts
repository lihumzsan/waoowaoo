import { beforeEach, describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { beginProjectAgentWaitContinuationExecution } from '@/lib/project-agent/waits'
import { appendProjectAssistantThreadMessages, loadProjectAssistantThread } from '@/lib/project-agent/persistence'
import {
  finalizeProjectAgentContinuationHandoff,
  loadProjectAgentContinuationCheckpoint,
  settleProjectAgentContinuationTerminalHandoff,
} from '@/lib/project-agent/execution-handoff'
const RUN_ID = 'continuation-run-1'
const WAIT_ID = 'continuation-wait-1'
const WAIT_ACTIVITY_ID = 'continuation-wait-activity-1'
const COMMAND_ID = 'continuation-command-1'
const FIRST_CLAIM = 'continuation-claim-1'

async function seedClaimedContinuation() {
  const user = await createTestUser()
  const project = await createTestProject(user.id)
  const episode = await prisma.projectEpisode.create({
    data: {
      projectId: project.id,
      episodeNumber: 1,
      name: 'Continuation episode',
    },
  })
  await prisma.projectAgentRun.create({
    data: {
      id: RUN_ID,
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      scopeRef: `episode:${episode.id}`,
      episodeId: episode.id,
      requestId: COMMAND_ID,
      status: 'running',
      runVersion: 1,
      eventSeq: BigInt(0),
      controlKind: 'task_follow_up',
    },
  })
  await prisma.projectAgentActivity.create({
    data: {
      id: WAIT_ACTIVITY_ID,
      runId: RUN_ID,
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      scopeRef: `episode:${episode.id}`,
      episodeId: episode.id,
      type: 'waiting_task',
      status: 'completed',
      operationId: 'create_video',
      completedAt: new Date(),
    },
  })
  await prisma.projectAgentWait.create({
    data: {
      id: WAIT_ID,
      runId: RUN_ID,
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      scopeRef: `episode:${episode.id}`,
      episodeId: episode.id,
      operationId: 'create_video',
      activityId: WAIT_ACTIVITY_ID,
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
  return { user, project, episode }
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

  it('atomically commits the terminal continuation message, checkpoint, Activity, Wait, and Run', async () => {
    const { user, project, episode } = await seedClaimedContinuation()
    const message = buildAssistantMessage()

    await expect(
      beginProjectAgentWaitContinuationExecution({
        runId: RUN_ID,
        waitId: WAIT_ID,
        commandId: COMMAND_ID,
        claimOwner: FIRST_CLAIM,
        projectId: project.id,
        userId: user.id,
      }),
    ).resolves.toBe('started')

    const settled = await settleProjectAgentContinuationTerminalHandoff({
      waitId: WAIT_ID,
      runId: RUN_ID,
      commandId: COMMAND_ID,
      projectId: project.id,
      userId: user.id,
      claimOwner: FIRST_CLAIM,
      outcome: 'completed',
      message,
    })
    expect(
      await loadProjectAgentContinuationCheckpoint({
        waitId: WAIT_ID,
        runId: RUN_ID,
        commandId: COMMAND_ID,
      }),
    ).toEqual(settled)

    const thread = await loadProjectAssistantThread({
      projectId: project.id,
      userId: user.id,
      episodeId: episode.id,
      assistantId: 'workspace-command',
    })
    const [wait, activity, run, checkpointCount, events] = await Promise.all([
      prisma.projectAgentWait.findUnique({ where: { id: WAIT_ID } }),
      prisma.projectAgentActivity.findUnique({
        where: { id: WAIT_ACTIVITY_ID },
      }),
      prisma.projectAgentRun.findUnique({ where: { id: RUN_ID } }),
      prisma.projectAgentContinuationCheckpoint.count({
        where: { waitId: WAIT_ID },
      }),
      prisma.projectAgentEvent.findMany({
        where: { runId: RUN_ID },
        orderBy: { id: 'asc' },
        select: { kind: true },
      }),
    ])
    expect(thread?.messages).toEqual([message])
    expect(checkpointCount).toBe(1)
    expect(wait).toMatchObject({ status: 'followed', claimId: FIRST_CLAIM })
    expect(activity?.status).toBe('completed')
    expect(run).toMatchObject({ status: 'completed', stopReason: 'completed' })
    expect(events.map((event) => event.kind)).toEqual(['wait.followed', 'run.completed'])
  })

  it('rolls back the whole terminal handoff when no checkpoint exists', async () => {
    const { user, project } = await seedClaimedContinuation()

    await expect(
      finalizeProjectAgentContinuationHandoff({
        runId: RUN_ID,
        waitId: WAIT_ID,
        commandId: COMMAND_ID,
        claimOwner: FIRST_CLAIM,
        projectId: project.id,
        userId: user.id,
      }),
    ).rejects.toThrow(`PROJECT_AGENT_CONTINUATION_CHECKPOINT_MISSING:${COMMAND_ID}`)

    const [wait, activity, run, eventCount] = await Promise.all([
      prisma.projectAgentWait.findUnique({ where: { id: WAIT_ID } }),
      prisma.projectAgentActivity.findUnique({
        where: { id: WAIT_ACTIVITY_ID },
      }),
      prisma.projectAgentRun.findUnique({ where: { id: RUN_ID } }),
      prisma.projectAgentEvent.count({ where: { runId: RUN_ID } }),
    ])
    expect(wait).toMatchObject({
      status: 'claimed',
      claimId: FIRST_CLAIM,
      followedAt: null,
    })
    expect(activity?.status).toBe('completed')
    expect(run?.status).toBe('running')
    expect(eventCount).toBe(0)
  })

  it('projects an unknown continuation outcome as its own terminal reason without replaying it as a tool error', async () => {
    const { user, project, episode } = await seedClaimedContinuation()
    const message: UIMessage = {
      id: `workspace-continuation-outcome-unknown:${COMMAND_ID}`,
      role: 'assistant',
      parts: [
        {
          type: 'data-agent-run',
          data: {
            runId: RUN_ID,
            requestId: COMMAND_ID,
            status: 'failed',
            controlKind: 'task_follow_up',
            stopReason: 'continuation_outcome_unknown',
          },
        },
      ],
    }

    await expect(
      beginProjectAgentWaitContinuationExecution({
        runId: RUN_ID,
        waitId: WAIT_ID,
        commandId: COMMAND_ID,
        claimOwner: FIRST_CLAIM,
        projectId: project.id,
        userId: user.id,
      }),
    ).resolves.toBe('started')
    await settleProjectAgentContinuationTerminalHandoff({
      runId: RUN_ID,
      waitId: WAIT_ID,
      commandId: COMMAND_ID,
      claimOwner: FIRST_CLAIM,
      projectId: project.id,
      userId: user.id,
      outcome: 'outcome_unknown',
      message,
    })

    const [wait, activity, run, thread] = await Promise.all([
      prisma.projectAgentWait.findUnique({ where: { id: WAIT_ID } }),
      prisma.projectAgentActivity.findUnique({
        where: { id: WAIT_ACTIVITY_ID },
      }),
      prisma.projectAgentRun.findUnique({ where: { id: RUN_ID } }),
      loadProjectAssistantThread({
        projectId: project.id,
        userId: user.id,
        episodeId: episode.id,
        assistantId: 'workspace-command',
      }),
    ])
    expect(wait).toMatchObject({ status: 'followed', claimId: FIRST_CLAIM })
    expect(activity).toMatchObject({ status: 'completed' })
    expect(run).toMatchObject({
      status: 'failed',
      stopReason: 'continuation_outcome_unknown',
      errorCode: 'PROJECT_AGENT_CONTINUATION_OUTCOME_UNKNOWN',
    })
    expect(thread?.messages).toEqual([message])
  })

  it('serializes concurrent thread appends without dropping either message', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const first: UIMessage = {
      id: 'concurrent-message-1',
      role: 'user',
      parts: [{ type: 'text', text: 'first' }],
    }
    const second: UIMessage = {
      id: 'concurrent-message-2',
      role: 'assistant',
      parts: [{ type: 'text', text: 'second' }],
    }

    await Promise.all([
      appendProjectAssistantThreadMessages({
        projectId: project.id,
        userId: user.id,
        assistantId: 'workspace-command',
        messages: [first],
      }),
      appendProjectAssistantThreadMessages({
        projectId: project.id,
        userId: user.id,
        assistantId: 'workspace-command',
        messages: [second],
      }),
    ])

    const thread = await loadProjectAssistantThread({
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
    })
    expect(new Set(thread?.messages.map((message) => message.id))).toEqual(new Set([first.id, second.id]))
  })
})
