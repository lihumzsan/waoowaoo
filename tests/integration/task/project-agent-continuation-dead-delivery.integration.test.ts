import { beforeEach, describe, expect, it } from 'vitest'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { prisma } from '../../helpers/prisma'
import {
  beginProjectAgentWaitContinuationExecution,
  claimProjectAgentWaitContinuation,
  releaseProjectAgentWaitContinuationClaim,
  startProjectAgentWaitFollowUp,
} from '@/lib/project-agent/waits'
import { loadProjectAssistantThread } from '@/lib/project-agent/persistence'
import { settleProjectAgentWaitContinuationDeliveryExhausted } from '@/lib/project-agent/server-follow-up'

const RUN_ID = 'dead-delivery-run-1'
const WAIT_ID = 'dead-delivery-wait-1'
const COMMAND_ID = 'dead-delivery-command-1'
const FIRST_CLAIM = 'dead-delivery-claim-1'
const SOURCE_ACTIVITY_ID = 'dead-delivery-source-activity-1'

const continuationCommand = {
  kind: 'project_agent.continue_wait' as const,
  waitId: WAIT_ID,
  runId: RUN_ID,
  expectedRunVersion: 1,
  expectedEventSeq: '0',
}

async function seedResolvedContinuation(status: 'resolved' | 'abandoned' = 'resolved') {
  const user = await createTestUser()
  const project = await createTestProject(user.id)
  const scopeRef = `project:${project.id}`
  await prisma.projectAgentRun.create({
    data: {
      id: RUN_ID,
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      scopeRef,
      requestId: COMMAND_ID,
      status: status === 'abandoned' ? 'cancelled' : 'awaiting_task',
      runVersion: 1,
      eventSeq: BigInt(0),
      controlKind: 'user_turn',
      cancelledAt: status === 'abandoned' ? new Date() : null,
    },
  })
  await prisma.projectAgentActivity.create({
    data: {
      id: SOURCE_ACTIVITY_ID,
      runId: RUN_ID,
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      scopeRef,
      type: 'waiting_task',
      status: 'completed',
      operationId: 'generate_episode_videos',
      completedAt: new Date(),
    },
  })
  await prisma.projectAgentWait.create({
    data: {
      id: WAIT_ID,
      runId: RUN_ID,
      activityId: SOURCE_ACTIVITY_ID,
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      scopeRef,
      operationId: 'generate_episode_videos',
      taskIds: ['task-1'],
      followUpMode: 'resume_agent',
      status,
      runVersion: 1,
      eventSeq: BigInt(0),
      terminalStatus: 'completed',
      terminalTaskIds: ['task-1'],
      failedTaskIds: [],
      canceledTaskIds: [],
      followUpKey: `project-agent-wait:${WAIT_ID}:completed`,
      resolvedAt: new Date(),
    },
  })
  return { user, project }
}

describe('Project Agent continuation dead delivery settlement DB integration', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  it('settles final delivery exhaustion once through checkpoint, Wait, Run, and Thread', async () => {
    const { user, project } = await seedResolvedContinuation()

    await expect(settleProjectAgentWaitContinuationDeliveryExhausted(
      continuationCommand,
      COMMAND_ID,
    )).resolves.toBe('settled')

    const [wait, activity, run, checkpoint, events, thread] = await Promise.all([
      prisma.projectAgentWait.findUniqueOrThrow({ where: { id: WAIT_ID } }),
      prisma.projectAgentActivity.findUniqueOrThrow({ where: { id: SOURCE_ACTIVITY_ID } }),
      prisma.projectAgentRun.findUniqueOrThrow({ where: { id: RUN_ID } }),
      prisma.projectAgentContinuationCheckpoint.findUniqueOrThrow({ where: { commandId: COMMAND_ID } }),
      prisma.projectAgentEvent.findMany({ where: { runId: RUN_ID }, orderBy: { id: 'asc' } }),
      loadProjectAssistantThread({
        projectId: project.id,
        userId: user.id,
        assistantId: 'workspace-command',
      }),
    ])
    expect(wait).toMatchObject({ status: 'followed', followUpCommandId: COMMAND_ID })
    expect(activity).toMatchObject({ status: 'completed' })
    expect(run).toMatchObject({
      status: 'failed',
      stopReason: 'continuation_delivery_exhausted',
      errorCode: 'PROJECT_AGENT_CONTINUATION_DELIVERY_EXHAUSTED',
    })
    expect(checkpoint).toMatchObject({
      status: 'settled',
      outcome: 'delivery_exhausted',
      messageId: `workspace-continuation-delivery-exhausted:${COMMAND_ID}`,
    })
    expect(events.map((event) => event.kind)).toEqual([
      'run.execution_started',
      'run.status_changed',
      'wait.followed',
      'run.failed',
    ])
    expect(thread?.messages).toEqual([
      expect.objectContaining({ id: `workspace-continuation-delivery-exhausted:${COMMAND_ID}` }),
    ])

    await expect(settleProjectAgentWaitContinuationDeliveryExhausted(
      continuationCommand,
      COMMAND_ID,
    )).resolves.toBe('already_settled')
    await expect(prisma.projectAgentEvent.count({ where: { runId: RUN_ID } })).resolves.toBe(4)
    await expect(prisma.projectAgentContinuationCheckpoint.count({ where: { waitId: WAIT_ID } })).resolves.toBe(1)
    await expect(loadProjectAssistantThread({
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
    })).resolves.toMatchObject({ messages: [
      expect.objectContaining({ id: `workspace-continuation-delivery-exhausted:${COMMAND_ID}` }),
    ] })
  })

  it('settles an already-running checkpoint as outcome_unknown instead of delivery_exhausted', async () => {
    const { user, project } = await seedResolvedContinuation()
    const claim = await claimProjectAgentWaitContinuation({
      ...continuationCommand,
      commandId: COMMAND_ID,
      claimOwner: FIRST_CLAIM,
    })
    expect(claim.status).toBe('claimed')
    await expect(startProjectAgentWaitFollowUp({
      runId: RUN_ID,
      waitId: WAIT_ID,
      commandId: COMMAND_ID,
      claimOwner: FIRST_CLAIM,
      projectId: project.id,
      userId: user.id,
    })).resolves.toMatchObject({ waitId: WAIT_ID })
    await expect(beginProjectAgentWaitContinuationExecution({
      runId: RUN_ID,
      waitId: WAIT_ID,
      commandId: COMMAND_ID,
      claimOwner: FIRST_CLAIM,
      projectId: project.id,
      userId: user.id,
    })).resolves.toBe('started')
    await expect(releaseProjectAgentWaitContinuationClaim({
      waitId: WAIT_ID,
      commandId: COMMAND_ID,
      claimOwner: FIRST_CLAIM,
    })).resolves.toBe(true)

    await expect(settleProjectAgentWaitContinuationDeliveryExhausted(
      continuationCommand,
      COMMAND_ID,
    )).resolves.toBe('settled')

    await expect(prisma.projectAgentContinuationCheckpoint.findUniqueOrThrow({
      where: { commandId: COMMAND_ID },
    })).resolves.toMatchObject({ status: 'settled', outcome: 'outcome_unknown' })
    await expect(prisma.projectAgentRun.findUniqueOrThrow({ where: { id: RUN_ID } }))
      .resolves.toMatchObject({
        status: 'failed',
        stopReason: 'continuation_outcome_unknown',
        errorCode: 'PROJECT_AGENT_CONTINUATION_OUTCOME_UNKNOWN',
      })
  })

  it('leaves an abandoned Wait and terminal Run untouched', async () => {
    await seedResolvedContinuation('abandoned')

    await expect(settleProjectAgentWaitContinuationDeliveryExhausted(
      continuationCommand,
      COMMAND_ID,
    )).resolves.toBe('not_applicable')

    await expect(prisma.projectAgentWait.findUniqueOrThrow({ where: { id: WAIT_ID } }))
      .resolves.toMatchObject({ status: 'abandoned', followUpCommandId: null, followedAt: null })
    await expect(prisma.projectAgentRun.findUniqueOrThrow({ where: { id: RUN_ID } }))
      .resolves.toMatchObject({ status: 'cancelled' })
    await expect(prisma.projectAgentContinuationCheckpoint.count({ where: { waitId: WAIT_ID } }))
      .resolves.toBe(0)
    await expect(prisma.projectAgentEvent.count({ where: { runId: RUN_ID } })).resolves.toBe(0)
  })
})
