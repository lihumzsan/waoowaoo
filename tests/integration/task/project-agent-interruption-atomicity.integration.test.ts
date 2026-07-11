import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { createProjectAgentUserTurnRun } from '@/lib/project-agent/runs'
import {
  prepareProjectAgentApprovalExecutionHandoff,
  settleProjectAgentPreparedApprovalHandoff,
} from '@/lib/project-agent/execution-handoff'

const TEST_PREFIX = 'interruption-atomicity:'

async function settleApprovalHandoff(
  input: Omit<Parameters<typeof prepareProjectAgentApprovalExecutionHandoff>[0], 'executionSegmentId'> & {
    message: UIMessage
  },
) {
  const { message, ...prepareInput } = input
  const handoff = await prepareProjectAgentApprovalExecutionHandoff({
    ...prepareInput,
    executionSegmentId: `test-approval:${input.approvalId}`,
  })
  return await settleProjectAgentPreparedApprovalHandoff({
    executionFence: input.executionFence,
    handoff,
    projectId: input.projectId,
    userId: input.userId,
    episodeId: input.episodeId ?? null,
    assistantId: input.assistantId,
    message,
  })
}

describe('Project Agent interruption atomic replacement DB integration', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  afterEach(async () => {
    await resetBillingState()
  })

  it('replaces a pending approval without accepting an arbitrary predecessor Activity', async () => {
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
    const firstSuspension = await settleApprovalHandoff({
      executionFence: {
        runFence: {
          runId: run.id,
          runVersion: run.runVersion,
          eventSeq: run.eventSeq,
        },
        signal: new AbortController().signal,
      },
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      operationId: 'generate_edit_style_previews',
      approvalId: `${TEST_PREFIX}approval-first`,
      toolCallId: `${TEST_PREFIX}tool-first`,
      runState: '{"checkpoint":"first"}',
      message: {
        id: `${TEST_PREFIX}assistant-first`,
        role: 'assistant',
        parts: [{ type: 'text', text: 'first approval' }],
      },
    })
    if (firstSuspension.kind !== 'approval') throw new Error('EXPECTED_APPROVAL_SUSPENSION')
    const firstInterruptionId = firstSuspension.interruptionId
    const firstInterruption = await prisma.projectAgentInterruption.findUniqueOrThrow({
      where: { id: firstInterruptionId },
      select: { activityId: true, status: true },
    })
    const currentRun = await prisma.projectAgentRun.findUniqueOrThrow({
      where: { id: run.id },
      select: { runVersion: true, eventSeq: true },
    })
    const eventCountBefore = await prisma.projectAgentEvent.count({ where: { runId: run.id } })

    const replacement = await settleApprovalHandoff({
      executionFence: {
        runFence: {
          runId: run.id,
          runVersion: currentRun.runVersion,
          eventSeq: currentRun.eventSeq.toString(),
        },
        signal: new AbortController().signal,
      },
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      operationId: 'generate_edit_style_previews',
      approvalId: `${TEST_PREFIX}approval-replacement`,
      toolCallId: `${TEST_PREFIX}tool-replacement`,
      runState: '{"checkpoint":"replacement"}',
      message: {
        id: `${TEST_PREFIX}assistant-replacement`,
        role: 'assistant',
        parts: [{ type: 'text', text: 'replacement approval' }],
      },
    })
    if (replacement.kind !== 'approval') throw new Error('EXPECTED_APPROVAL_SUSPENSION')

    expect(await prisma.projectAgentInterruption.findMany({
      where: { runId: run.id },
      select: { id: true, status: true },
      orderBy: { id: 'asc' },
    })).toEqual([
      { id: firstInterruptionId, status: 'superseded' },
      { id: replacement.interruptionId, status: 'pending' },
    ].sort((left, right) => left.id.localeCompare(right.id)))
    expect(await prisma.projectAgentActivity.findUnique({
      where: { id: firstInterruption.activityId ?? '' },
      select: { status: true },
    })).toEqual({ status: 'cancelled' })
    expect(await prisma.projectAgentEvent.count({ where: { runId: run.id } }))
      .toBe(eventCountBefore + 2)
  })
})
