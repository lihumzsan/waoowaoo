import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { makeTestOperation, EFFECTS_BILLABLE } from '../../helpers/project-agent-operations'
import { persistOperationPlanSnapshot } from '@/lib/operations/operation-plan-snapshot'
import { invokeApprovedOperationPlan, issueApprovalGrant } from '@/lib/operations/planned-operation-invocation'
import type { BillingQuoteView, OperationPlan } from '@/lib/operations/planning'

const OPERATION_ID = 'approval_grant_expiry_fixture'

async function seedGrant() {
  const user = await createTestUser()
  const project = await createTestProject(user.id)
  const plan: OperationPlan = {
    kind: 'task_submission',
    operationId: OPERATION_ID,
    projectId: project.id,
    userId: user.id,
    tasks: [],
  }
  const quote: BillingQuoteView = {
    showCredits: true,
    billingMode: 'ENFORCE',
    billable: true,
    taskCount: 0,
    mediaTaskCount: 0,
    totalMaxFrozenCost: 0,
    currency: 'credits',
    items: [],
  }
  const snapshot = await persistOperationPlanSnapshot({
    plan,
    normalizedInput: { episodeId: null },
    quote,
  })
  const issued = await issueApprovalGrant({
    userId: user.id,
    planSnapshotId: snapshot.id,
    requestId: 'approval-grant-expiry-request',
  })
  return { user, project, plan, snapshot, issued }
}

function buildOperation(commit: ReturnType<typeof vi.fn>) {
  return makeTestOperation({
    id: OPERATION_ID,
    intent: 'act',
    effects: EFFECTS_BILLABLE,
    confirmation: { kind: 'billable_media', required: true },
    inputSchema: z.object({ episodeId: z.null() }),
    outputSchema: z.object({ durable: z.string() }),
    plan: async (_ctx, _input) => {
      throw new Error('REPLAY_MUST_NOT_REPLAN')
    },
    commit,
  })
}

describe('ApprovalGrant expiry and durable replay integration', () => {
  beforeEach(async () => {
    await resetBillingState()
    await prisma.operationExecution.deleteMany()
    await prisma.approvalGrant.deleteMany()
    await prisma.operationPlanSnapshot.deleteMany()
  })

  it('rejects an unconsumed expired Grant without creating execution side effects', async () => {
    const seeded = await seedGrant()
    const expiredAt = new Date(Date.now() - 1_000)
    await prisma.$transaction([
      prisma.approvalGrant.update({
        where: { id: seeded.issued.approvalGrantId },
        data: { expiresAt: expiredAt },
      }),
      prisma.operationPlanSnapshot.update({
        where: { id: seeded.snapshot.id },
        data: { expiresAt: expiredAt },
      }),
    ])
    const commit = vi.fn(async () => ({ durable: 'must-not-run' }))

    await expect(invokeApprovedOperationPlan({
      operation: buildOperation(commit),
      ctx: {
        request: new NextRequest('http://localhost/api/operations/execute'),
        userId: seeded.user.id,
        projectId: seeded.project.id,
        context: {},
        source: 'integration-test',
        writer: null,
        toolCallId: null,
      },
      normalizedInput: { episodeId: null },
      invocation: {
        approvalGrantId: seeded.issued.approvalGrantId,
        requestId: seeded.issued.operationRequestId,
      },
    })).rejects.toMatchObject({
      details: expect.objectContaining({ code: 'APPROVAL_GRANT_NOT_USABLE' }),
    })
    expect(commit).not.toHaveBeenCalled()
    expect(await prisma.operationExecution.count()).toBe(0)
    expect(await prisma.task.count()).toBe(0)
  })

  it('returns persisted output after TTL without re-running an already consumed execution', async () => {
    const seeded = await seedGrant()
    const commit = vi.fn(async () => ({ durable: 'persisted-output' }))
    const params = {
      operation: buildOperation(commit),
      ctx: {
        request: new NextRequest('http://localhost/api/operations/execute'),
        userId: seeded.user.id,
        projectId: seeded.project.id,
        context: {},
        source: 'integration-test',
        writer: null,
        toolCallId: null,
      },
      normalizedInput: { episodeId: null },
      invocation: {
        approvalGrantId: seeded.issued.approvalGrantId,
        requestId: seeded.issued.operationRequestId,
      },
    } as const

    await expect(invokeApprovedOperationPlan(params)).resolves.toEqual({ durable: 'persisted-output' })
    const execution = await prisma.operationExecution.findUniqueOrThrow({
      where: { approvalGrantId: seeded.issued.approvalGrantId },
    })
    const expiredAt = new Date(Date.now() - 1_000)
    await prisma.$transaction([
      prisma.approvalGrant.update({
        where: { id: seeded.issued.approvalGrantId },
        data: { expiresAt: expiredAt },
      }),
      prisma.operationPlanSnapshot.update({
        where: { id: seeded.snapshot.id },
        data: { expiresAt: expiredAt },
      }),
    ])

    await expect(invokeApprovedOperationPlan(params)).resolves.toEqual({ durable: 'persisted-output' })
    expect(commit).toHaveBeenCalledTimes(1)
    expect(await prisma.operationExecution.count()).toBe(1)
    expect((await prisma.operationExecution.findUniqueOrThrow({ where: { id: execution.id } })).output)
      .toEqual({ durable: 'persisted-output' })
    expect(await prisma.task.count()).toBe(0)
  })
})
