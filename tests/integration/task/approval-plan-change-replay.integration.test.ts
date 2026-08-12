import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { persistOperationPlanSnapshot } from '@/lib/operations/operation-plan-snapshot'
import { invokeApprovedOperationPlan, issueApprovalGrant } from '@/lib/operations/planned-operation-invocation'
import { quoteOperationPlan } from '@/lib/operations/planning'
import type { OperationPlan } from '@/lib/operations/plan-contract'
import { defineOperation } from '@/lib/operations/define-operation'
import { withOperationPack } from '@/lib/operations/pack'
import { isBillablePlannedOperation } from '@/lib/operations/types'

const OPERATION_ID = 'approval_plan_change_fixture'
const PLAN_CONTRACT_REVISION = 'approval-plan-change-fixture/v1'

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
  const quote = await quoteOperationPlan(plan)
  const snapshot = await persistOperationPlanSnapshot({
    plan,
    executionContractRevision: PLAN_CONTRACT_REVISION,
    normalizedInput: {},
    quote,
  })
  const issued = await issueApprovalGrant({
    userId: user.id,
    planSnapshotId: snapshot.id,
    requestId: 'approval-plan-change-request',
  })
  return { user, project, plan, snapshot, issued }
}

function buildOperation(params: {
  plan: ReturnType<typeof vi.fn<() => Promise<OperationPlan>>>
  commit: ReturnType<typeof vi.fn<() => Promise<{ durable: string }>>>
  planContractRevision?: string
}) {
  const operation = defineOperation({
    id: OPERATION_ID,
    summary: 'Exercise immutable approval replay against a real database transaction.',
    intent: 'act',
    effects: {
      writes: false,
      billable: true,
      destructive: false,
      overwrite: false,
      bulk: false,
      externalSideEffects: true,
      longRunning: true,
    },
    resourceContract: {
      kind: 'none',
      reason: 'The fixture proves approval transaction semantics without producing a Resource.',
    },
    confirmation: { kind: 'billable_media', required: true },
    planContractRevision: params.planContractRevision ?? PLAN_CONTRACT_REVISION,
    inputSchema: z.object({}).strict(),
    outputSchema: z.object({ durable: z.string() }),
    plan: async () => await params.plan(),
    commit: async () => await params.commit(),
  })
  const packed = withOperationPack({ [OPERATION_ID]: operation }, {
    groupPath: ['test'],
    channels: { tool: true, api: true, mcp: false },
    confirmation: { kind: 'none', required: false },
  })[OPERATION_ID]
  if (!packed || !isBillablePlannedOperation(packed)) {
    throw new Error('APPROVAL_PLAN_CHANGE_FIXTURE_OPERATION_INVALID')
  }
  return packed
}

function invocationParams(input: {
  seeded: Awaited<ReturnType<typeof seedGrant>>
  operation: ReturnType<typeof buildOperation>
}) {
  return {
    operation: input.operation,
    ctx: {
      request: new NextRequest('http://localhost/api/operations/execute'),
      userId: input.seeded.user.id,
      projectId: input.seeded.project.id,
      context: {},
      source: 'integration-test',
      writer: null,
      toolCallId: null,
    },
    normalizedInput: {},
    invocation: {
      approvalGrantId: input.seeded.issued.approvalGrantId,
      requestId: input.seeded.issued.operationRequestId,
    },
  } as const
}

describe('Approval plan change and durable replay integration', () => {
  beforeEach(async () => {
    await resetBillingState()
    await prisma.operationExecution.deleteMany()
    await prisma.approvalGrant.deleteMany()
    await prisma.operationPlanSnapshot.deleteMany()
  })

  it('executes an unchanged Grant after the former TTL window', async () => {
    const seeded = await seedGrant()
    const formerTtlBoundary = new Date('2020-01-01T00:00:00.000Z')
    await prisma.$transaction([
      prisma.operationPlanSnapshot.update({
        where: { id: seeded.snapshot.id },
        data: { createdAt: formerTtlBoundary },
      }),
      prisma.approvalGrant.update({
        where: { id: seeded.issued.approvalGrantId },
        data: {
          issuedAt: formerTtlBoundary,
          createdAt: formerTtlBoundary,
          updatedAt: formerTtlBoundary,
        },
      }),
    ])
    const expiryColumns = await prisma.$queryRaw<Array<{ tableName: string }>>`
      SELECT TABLE_NAME AS tableName
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN ('operation_plan_snapshots', 'approval_grants')
        AND COLUMN_NAME = 'expiresAt'
      ORDER BY TABLE_NAME
    `
    const plan = vi.fn(async (): Promise<OperationPlan> => seeded.plan)
    const commit = vi.fn(async () => ({ durable: 'aged-plan-executed' }))

    expect(expiryColumns).toEqual([])
    await expect(invokeApprovedOperationPlan(invocationParams({
      seeded,
      operation: buildOperation({ plan, commit }),
    }))).resolves.toEqual({ durable: 'aged-plan-executed' })

    const [grant, execution] = await Promise.all([
      prisma.approvalGrant.findUniqueOrThrow({ where: { id: seeded.issued.approvalGrantId } }),
      prisma.operationExecution.findUniqueOrThrow({
        where: { approvalGrantId: seeded.issued.approvalGrantId },
      }),
    ])
    expect(plan).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(grant).toMatchObject({ revokedAt: null, version: 1 })
    expect(grant.consumedAt).not.toBeNull()
    expect(grant.consumedExecutionId).toBe(execution.id)
    expect(await prisma.operationExecution.count()).toBe(1)
    expect(await prisma.task.count()).toBe(0)
  })

  it('revokes an unconsumed Grant when the current registry plan changed', async () => {
    const seeded = await seedGrant()
    const plan = vi.fn(async (): Promise<OperationPlan> => ({
      ...seeded.plan,
      metadata: { revision: 'changed' },
    }))
    const commit = vi.fn(async () => ({ durable: 'must-not-run' }))

    await expect(invokeApprovedOperationPlan(invocationParams({
      seeded,
      operation: buildOperation({ plan, commit }),
    }))).rejects.toMatchObject({
      code: 'OPERATION_PLAN_CHANGED',
    })

    expect(plan).toHaveBeenCalledTimes(1)
    expect(commit).not.toHaveBeenCalled()
    expect(await prisma.operationExecution.count()).toBe(0)
    expect(await prisma.task.count()).toBe(0)
    expect((await prisma.approvalGrant.findUniqueOrThrow({ where: { id: seeded.issued.approvalGrantId } })).revokedAt)
      .not.toBeNull()
  })

  it('revokes without replanning when the execution contract revision changed', async () => {
    const seeded = await seedGrant()
    const plan = vi.fn(async (): Promise<OperationPlan> => seeded.plan)
    const commit = vi.fn(async () => ({ durable: 'must-not-run' }))

    await expect(invokeApprovedOperationPlan(invocationParams({
      seeded,
      operation: buildOperation({
        plan,
        commit,
        planContractRevision: 'approval-plan-change-fixture/v2',
      }),
    }))).rejects.toMatchObject({
      code: 'OPERATION_PLAN_CHANGED',
      details: {
        changedArtifacts: ['executionContractRevision'],
      },
    })

    expect(plan).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
    expect(await prisma.operationExecution.count()).toBe(0)
    expect(await prisma.task.count()).toBe(0)
    expect((await prisma.approvalGrant.findUniqueOrThrow({
      where: { id: seeded.issued.approvalGrantId },
    })).revokedAt).not.toBeNull()
  })

  it('returns persisted output without replanning an already consumed execution', async () => {
    const seeded = await seedGrant()
    let currentPlan = seeded.plan
    const plan = vi.fn(async (): Promise<OperationPlan> => currentPlan)
    const commit = vi.fn(async () => ({ durable: 'persisted-output' }))
    const params = invocationParams({ seeded, operation: buildOperation({ plan, commit }) })

    await expect(invokeApprovedOperationPlan(params)).resolves.toEqual({ durable: 'persisted-output' })
    currentPlan = { ...seeded.plan, metadata: { revision: 'changed-after-commit' } }
    await expect(invokeApprovedOperationPlan(params)).resolves.toEqual({ durable: 'persisted-output' })

    expect(plan).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(await prisma.operationExecution.count()).toBe(1)
    expect(await prisma.task.count()).toBe(0)
  })
})
