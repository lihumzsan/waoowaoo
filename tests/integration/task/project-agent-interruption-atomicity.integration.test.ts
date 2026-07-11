import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { createProjectAgentUserTurnRun } from '@/lib/project-agent/runs'
import { createProjectAgentApprovalInterruption } from '@/lib/project-agent/interruptions'

const TEST_PREFIX = 'interruption-atomicity:'

describe('Project Agent interruption atomic replacement DB integration', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  afterEach(async () => {
    await resetBillingState()
  })

  it('rolls back supersede when the replacement approval cannot finish raising', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const { run } = await createProjectAgentUserTurnRun({
      runId: `${TEST_PREFIX}run`,
      requestId: `${TEST_PREFIX}request`,
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      message: {
        id: `${TEST_PREFIX}message`,
        role: 'user',
        parts: [{ type: 'text', text: 'start' }],
      },
    })
    const firstInterruptionId = await createProjectAgentApprovalInterruption({
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      runId: run.id,
      runFence: {
        runId: run.id,
        runVersion: run.runVersion,
        eventSeq: run.eventSeq,
      },
      operationId: 'generate_edit_style_previews',
      approvalId: `${TEST_PREFIX}approval-first`,
      toolCallId: `${TEST_PREFIX}tool-first`,
      runState: '{"checkpoint":"first"}',
    })
    const firstInterruption = await prisma.projectAgentInterruption.findUniqueOrThrow({
      where: { id: firstInterruptionId },
      select: { activityId: true, status: true },
    })
    const currentRun = await prisma.projectAgentRun.findUniqueOrThrow({
      where: { id: run.id },
      select: { runVersion: true, eventSeq: true },
    })
    const eventCountBefore = await prisma.projectAgentEvent.count({ where: { runId: run.id } })

    await expect(createProjectAgentApprovalInterruption({
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      runId: run.id,
      runFence: {
        runId: run.id,
        runVersion: currentRun.runVersion,
        eventSeq: currentRun.eventSeq.toString(),
      },
      operationId: 'generate_edit_style_previews',
      approvalId: `${TEST_PREFIX}approval-replacement`,
      toolCallId: `${TEST_PREFIX}tool-replacement`,
      runState: '{"checkpoint":"replacement"}',
      previousActivityId: `${TEST_PREFIX}missing-activity`,
    })).rejects.toThrow('PROJECT_AGENT_ACTIVITY_TRANSITION_RACED')

    expect(await prisma.projectAgentInterruption.findMany({
      where: { runId: run.id },
      select: { id: true, status: true },
    })).toEqual([{ id: firstInterruptionId, status: 'pending' }])
    expect(await prisma.projectAgentActivity.findUnique({
      where: { id: firstInterruption.activityId ?? '' },
      select: { status: true },
    })).toEqual({ status: 'waiting' })
    expect(await prisma.projectAgentEvent.count({ where: { runId: run.id } }))
      .toBe(eventCountBefore)
  })
})
