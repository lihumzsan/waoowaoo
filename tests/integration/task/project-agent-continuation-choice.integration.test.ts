import { beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { beginProjectAgentWaitContinuationExecution } from '@/lib/project-agent/waits'
import { appendProjectAgentEvents } from '@/lib/project-agent/event'
import { createProjectAgentRunFence } from '@/lib/project-agent/run-fence'
import {
  prepareProjectAgentChoiceExecutionHandoff,
  settleProjectAgentPreparedChoiceHandoff,
} from '@/lib/project-agent/execution-handoff'
import { fingerprintProjectAgentChoiceSubject } from '@/lib/project-agent/choice-offer'
import type { ProjectAgentChoiceCommitment } from '@/lib/project-agent/choice-offer'
import { buildReadyProjectAgentModelHistoryCommit } from './project-agent-model-history.fixture'

const RUN_ID = 'continuation-choice-run-1'
const WAIT_ID = 'continuation-choice-wait-1'
const WAIT_ACTIVITY_ID = 'continuation-choice-wait-activity-1'
const COMMAND_ID = 'continuation-choice-command-1'
const CLAIM_ID = 'continuation-choice-claim-1'

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
  await prisma.projectAssistantThread.create({
    data: {
      projectId: project.id,
      userId: user.id,
      episodeId: episode.id,
      assistantId: 'workspace-command',
      scopeRef: `episode:${episode.id}`,
      messagesJson: [],
      modelHistoryJson: [],
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
      activityId: WAIT_ACTIVITY_ID,
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      scopeRef: `episode:${episode.id}`,
      episodeId: episode.id,
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
      claimId: CLAIM_ID,
      claimedAt: new Date(),
      claimExpiresAt: new Date(Date.now() + 60_000),
      resolvedAt: new Date(),
    },
  })
  return { user, project, episode }
}

describe('Project Agent continuation Choice DB integration', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  it('lets a task continuation run a normal tool, then atomically hand off to Choice without a segment Activity', async () => {
    const { user, project, episode } = await seedClaimedContinuation()
    await expect(
      beginProjectAgentWaitContinuationExecution({
        runId: RUN_ID,
        waitId: WAIT_ID,
        commandId: COMMAND_ID,
        claimOwner: CLAIM_ID,
        projectId: project.id,
        userId: user.id,
      }),
    ).resolves.toBe('started')

    const beforeOperation = await prisma.projectAgentRun.findUniqueOrThrow({
      where: { id: RUN_ID },
      select: { id: true, runVersion: true, eventSeq: true },
    })
    const operationFence = createProjectAgentRunFence(beforeOperation)
    const ordinaryActivityId = `${COMMAND_ID}:read-overview`
    await appendProjectAgentEvents({
      scope: {
        projectId: project.id,
        userId: user.id,
        episodeId: episode.id,
        assistantId: 'workspace-command',
      },
      events: [
        {
          runFence: operationFence,
          idempotencyKey: `activity-started:${ordinaryActivityId}`,
          event: {
            kind: 'activity.started',
            runId: RUN_ID,
            activityId: ordinaryActivityId,
            type: 'operation',
            operationId: 'get_episode_overview',
          },
        },
        {
          runFence: operationFence,
          idempotencyKey: `activity-completed:${ordinaryActivityId}`,
          event: {
            kind: 'activity.completed',
            runId: RUN_ID,
            activityId: ordinaryActivityId,
          },
        },
      ],
    })
    expect(
      await prisma.projectAgentActivity.findUnique({
        where: { id: COMMAND_ID },
        select: { status: true },
      }),
    ).toBeNull()

    const toolCallId = `${COMMAND_ID}:current-choice`
    const executionFence = {
      runFence: operationFence,
      signal: new AbortController().signal,
      continuationClaim: {
        waitId: WAIT_ID,
        commandId: COMMAND_ID,
        claimOwner: CLAIM_ID,
      },
    }
    const card = {
      cardId: `${COMMAND_ID}:current-choice-card`,
      toolCallId,
      mode: 'confirm_or_text' as const,
      replyMode: 'whole_card' as const,
      title: '采用当前创作方向吗？',
      description: '这个确认只作用于当前方向。',
      groups: [],
      submitLabel: '确认采用',
      replyLabel: '修改当前方向',
      replyPlaceholder: '描述希望修改的内容',
      replySubmitLabel: '提交修改',
    }
    const commitments: ProjectAgentChoiceCommitment[] = []
    const prepared = await prepareProjectAgentChoiceExecutionHandoff({
      executionFence,
      executionSegmentId: `wait-continuation:${COMMAND_ID}`,
      projectId: project.id,
      userId: user.id,
      episodeId: episode.id,
      assistantId: 'workspace-command',
      operationId: 'request_choice',
      toolCallId,
      card,
      subject: {
        kind: 'none',
        fingerprint: fingerprintProjectAgentChoiceSubject('none', { card, commitments }),
      },
      commitments,
      modelArguments: {
        subject: { kind: 'none' },
        card: {
          kind: 'confirm_or_text',
          title: card.title,
          description: card.description,
          confirmation: { label: card.submitLabel },
          reply: {
            label: card.replyLabel,
            placeholder: card.replyPlaceholder,
            submitLabel: card.replySubmitLabel,
          },
        },
      },
    })
    const suspension = await settleProjectAgentPreparedChoiceHandoff({
      executionFence,
      handoff: prepared,
      projectId: project.id,
      userId: user.id,
      episodeId: episode.id,
      assistantId: 'workspace-command',
      message: {
        id: `workspace-assistant-task-follow-up:${WAIT_ID}:${COMMAND_ID}:choice`,
        role: 'assistant',
        parts: [{ type: 'text', text: '请确认当前创作方向。' }],
      },
      modelHistoryCommit: await buildReadyProjectAgentModelHistoryCommit({
        projectId: project.id,
        userId: user.id,
        episodeId: episode.id,
        assistantId: 'workspace-command',
      }, prepared.executionSegmentId),
      continuation: {
        waitId: WAIT_ID,
        commandId: COMMAND_ID,
        claimOwner: CLAIM_ID,
        waitActivityId: WAIT_ACTIVITY_ID,
      },
    })

    const [followUpActivity, ordinaryActivity, wait, run, interruptions] = await Promise.all([
      prisma.projectAgentActivity.findUnique({
        where: { id: COMMAND_ID },
        select: { status: true },
      }),
      prisma.projectAgentActivity.findUnique({
        where: { id: ordinaryActivityId },
        select: { status: true },
      }),
      prisma.projectAgentWait.findUnique({
        where: { id: WAIT_ID },
        select: { status: true, followedAt: true },
      }),
      prisma.projectAgentRun.findUnique({
        where: { id: RUN_ID },
        select: { status: true, errorCode: true },
      }),
      prisma.projectAgentInterruption.findMany({
        where: { runId: RUN_ID },
        select: { id: true, status: true, operationId: true },
      }),
    ])
    expect(followUpActivity).toBeNull()
    expect(ordinaryActivity).toEqual({ status: 'completed' })
    expect(wait).toMatchObject({
      status: 'followed',
      followedAt: expect.any(Date),
    })
    expect(run).toEqual({ status: 'awaiting_choice', errorCode: null })
    expect(interruptions).toEqual([
      {
        id: suspension.interruptionId,
        status: 'pending',
        operationId: 'request_choice',
      },
    ])
  })
})
