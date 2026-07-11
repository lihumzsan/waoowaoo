import { beforeEach, describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import {
  beginProjectAgentWaitContinuationExecution,
} from '@/lib/project-agent/waits'
import {
  appendProjectAssistantThreadMessages,
  loadProjectAssistantThread,
} from '@/lib/project-agent/persistence'
import { appendProjectAgentEvents } from '@/lib/project-agent/event'
import { createProjectAgentRunFence } from '@/lib/project-agent/run-fence'
import {
  finalizeProjectAgentContinuationHandoff,
  loadProjectAgentContinuationCheckpoint,
  prepareProjectAgentChoiceExecutionHandoff,
  settleProjectAgentContinuationTerminalHandoff,
  settleProjectAgentPreparedChoiceHandoff,
} from '@/lib/project-agent/execution-handoff'
import { fingerprintProjectAgentChoiceResource } from '@/lib/project-agent/choice-offer'
const RUN_ID = 'continuation-run-1'
const WAIT_ID = 'continuation-wait-1'
const COMMAND_ID = 'continuation-command-1'
const FIRST_CLAIM = 'continuation-claim-1'

async function seedClaimedContinuation() {
  const user = await createTestUser()
  const project = await createTestProject(user.id)
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
      sourceOperationId: 'generate_episode_videos',
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
      operationId: 'generate_episode_videos',
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

  it('atomically commits the terminal continuation message, checkpoint, Activity, Wait, and Run', async () => {
    const { user, project } = await seedClaimedContinuation()
    const message = buildAssistantMessage()

    await expect(beginProjectAgentWaitContinuationExecution({
      runId: RUN_ID,
      waitId: WAIT_ID,
      commandId: COMMAND_ID,
      claimOwner: FIRST_CLAIM,
      projectId: project.id,
      userId: user.id,
    })).resolves.toBe('started')

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
    expect(await loadProjectAgentContinuationCheckpoint({
      waitId: WAIT_ID,
      runId: RUN_ID,
      commandId: COMMAND_ID,
    })).toEqual(settled)

    const thread = await loadProjectAssistantThread({
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
    })
    const [wait, activity, run, checkpointCount, events] = await Promise.all([
      prisma.projectAgentWait.findUnique({ where: { id: WAIT_ID } }),
      prisma.projectAgentActivity.findUnique({ where: { id: COMMAND_ID } }),
      prisma.projectAgentRun.findUnique({ where: { id: RUN_ID } }),
      prisma.projectAgentContinuationCheckpoint.count({ where: { waitId: WAIT_ID } }),
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
    expect(events.map((event) => event.kind)).toEqual([
      'activity.completed',
      'wait.followed',
      'run.completed',
    ])
  })

  it('rolls back the whole terminal handoff when no checkpoint exists', async () => {
    const { user, project } = await seedClaimedContinuation()

    await expect(finalizeProjectAgentContinuationHandoff({
      runId: RUN_ID,
      waitId: WAIT_ID,
      commandId: COMMAND_ID,
      claimOwner: FIRST_CLAIM,
      projectId: project.id,
      userId: user.id,
    })).rejects.toThrow(`PROJECT_AGENT_CONTINUATION_CHECKPOINT_MISSING:${COMMAND_ID}`)

    const [wait, activity, run, eventCount] = await Promise.all([
      prisma.projectAgentWait.findUnique({ where: { id: WAIT_ID } }),
      prisma.projectAgentActivity.findUnique({ where: { id: COMMAND_ID } }),
      prisma.projectAgentRun.findUnique({ where: { id: RUN_ID } }),
      prisma.projectAgentEvent.count({ where: { runId: RUN_ID } }),
    ])
    expect(wait).toMatchObject({ status: 'claimed', claimId: FIRST_CLAIM, followedAt: null })
    expect(activity?.status).toBe('running')
    expect(run?.status).toBe('running')
    expect(eventCount).toBe(0)
  })

  it('projects an unknown continuation outcome as its own terminal reason without replaying it as a tool error', async () => {
    const { user, project } = await seedClaimedContinuation()
    const message: UIMessage = {
      id: `workspace-continuation-outcome-unknown:${COMMAND_ID}`,
      role: 'assistant',
      parts: [{
        type: 'data-agent-run',
        data: {
          runId: RUN_ID,
          requestId: COMMAND_ID,
          status: 'failed',
          controlKind: 'task_follow_up',
          stopReason: 'continuation_outcome_unknown',
        },
      }],
    }

    await expect(beginProjectAgentWaitContinuationExecution({
      runId: RUN_ID,
      waitId: WAIT_ID,
      commandId: COMMAND_ID,
      claimOwner: FIRST_CLAIM,
      projectId: project.id,
      userId: user.id,
    })).resolves.toBe('started')
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
      prisma.projectAgentActivity.findUnique({ where: { id: COMMAND_ID } }),
      prisma.projectAgentRun.findUnique({ where: { id: RUN_ID } }),
      loadProjectAssistantThread({
        projectId: project.id,
        userId: user.id,
        assistantId: 'workspace-command',
      }),
    ])
    expect(wait).toMatchObject({ status: 'followed', claimId: FIRST_CLAIM })
    expect(activity).toMatchObject({
      status: 'failed',
      errorCode: 'PROJECT_AGENT_CONTINUATION_OUTCOME_UNKNOWN',
    })
    expect(run).toMatchObject({
      status: 'failed',
      stopReason: 'continuation_outcome_unknown',
      errorCode: 'PROJECT_AGENT_CONTINUATION_OUTCOME_UNKNOWN',
    })
    expect(thread?.messages).toEqual([message])
  })

  it('keeps the task follow-up Activity open through a normal tool, then settles it exactly once when Choice takes over', async () => {
    const { user, project } = await seedClaimedContinuation()
    await expect(beginProjectAgentWaitContinuationExecution({
      runId: RUN_ID,
      waitId: WAIT_ID,
      commandId: COMMAND_ID,
      claimOwner: FIRST_CLAIM,
      projectId: project.id,
      userId: user.id,
    })).resolves.toBe('started')

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
        assistantId: 'workspace-command',
      },
      events: [{
        runFence: operationFence,
        idempotencyKey: `activity-started:${ordinaryActivityId}`,
        event: {
          kind: 'activity.started',
          runId: RUN_ID,
          activityId: ordinaryActivityId,
          type: 'operation',
          operationId: 'get_episode_overview',
        },
      }, {
        runFence: operationFence,
        idempotencyKey: `activity-completed:${ordinaryActivityId}`,
        event: {
          kind: 'activity.completed',
          runId: RUN_ID,
          activityId: ordinaryActivityId,
        },
      }],
    })

    expect(await prisma.projectAgentActivity.findUniqueOrThrow({
      where: { id: COMMAND_ID },
      select: { status: true },
    })).toEqual({ status: 'running' })

    const toolCallId = `${COMMAND_ID}:script-review`
    const executionFence = {
      runFence: operationFence,
      signal: new AbortController().signal,
      continuationClaim: {
        waitId: WAIT_ID,
        commandId: COMMAND_ID,
        claimOwner: FIRST_CLAIM,
      },
    }
    const prepared = await prepareProjectAgentChoiceExecutionHandoff({
      executionFence,
      executionSegmentId: `wait-continuation:${COMMAND_ID}`,
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      operationId: 'request_script_intake_choice',
      toolCallId,
      card: {
        cardId: `${COMMAND_ID}:script-review-card`,
        toolCallId,
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
          cardId: `${COMMAND_ID}:script-review-card`,
          choiceType: 'script_intake',
          groups: [],
        },
      }),
    })
    const suspension = await settleProjectAgentPreparedChoiceHandoff({
      executionFence,
      handoff: prepared,
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      message: {
        id: `workspace-assistant-task-follow-up:${WAIT_ID}:${COMMAND_ID}:choice`,
        role: 'assistant',
        parts: [{ type: 'text', text: '请确认剧本。' }],
      },
      continuation: {
        waitId: WAIT_ID,
        commandId: COMMAND_ID,
        claimOwner: FIRST_CLAIM,
        executionActivityId: COMMAND_ID,
      },
    })

    const [followUpActivity, ordinaryActivity, wait, run, interruptions] = await Promise.all([
      prisma.projectAgentActivity.findUnique({ where: { id: COMMAND_ID }, select: { status: true } }),
      prisma.projectAgentActivity.findUnique({ where: { id: ordinaryActivityId }, select: { status: true } }),
      prisma.projectAgentWait.findUnique({ where: { id: WAIT_ID }, select: { status: true, followedAt: true } }),
      prisma.projectAgentRun.findUnique({ where: { id: RUN_ID }, select: { status: true, errorCode: true } }),
      prisma.projectAgentInterruption.findMany({
        where: { runId: RUN_ID },
        select: { id: true, status: true, operationId: true },
      }),
    ])
    expect(followUpActivity).toEqual({ status: 'completed' })
    expect(ordinaryActivity).toEqual({ status: 'completed' })
    expect(wait).toMatchObject({ status: 'followed', followedAt: expect.any(Date) })
    expect(run).toEqual({ status: 'awaiting_choice', errorCode: null })
    expect(interruptions).toEqual([{
      id: suspension.interruptionId,
      status: 'pending',
      operationId: 'request_script_intake_choice',
    }])
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
    expect(new Set(thread?.messages.map((message) => message.id))).toEqual(new Set([
      first.id,
      second.id,
    ]))
  })

})
