import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OperationPlanView } from '@/lib/operations/planning'

const apiFetchMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-fetch', () => ({ apiFetch: apiFetchMock }))

import { issueOperationApprovalGrant } from '@/lib/query/operation-plan-client'

function plan(planSnapshotId?: string): OperationPlanView {
  return {
    ...(planSnapshotId ? { planSnapshotId } : {}),
    operationId: 'regenerate_panel_image',
    kind: 'task_submission',
    taskCount: 1,
    tasks: [{
      id: 'planned-image',
      taskType: 'image_panel',
      targetType: 'ProjectPanel',
      targetId: 'panel-1',
    }],
    quote: {
      showCredits: true,
      billingMode: 'ENFORCE',
      billable: true,
      taskCount: 1,
      mediaTaskCount: 1,
      totalMaxFrozenCost: 3,
      currency: 'credits',
      items: [],
    },
  }
}

describe('operation plan approval grant client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiFetchMock.mockResolvedValue(new Response(JSON.stringify({
      approvalGrantId: 'grant-1',
      operationRequestId: 'request-authoritative',
    }), { status: 200 }))
  })

  it('issues a grant for the immutable persisted plan instead of sending a boolean', async () => {
    await expect(issueOperationApprovalGrant(plan('snapshot-1'))).resolves.toEqual({
      approvalGrantId: 'grant-1',
      operationRequestId: 'request-authoritative',
    })
    expect(apiFetchMock).toHaveBeenCalledWith('/api/operation-approval-grants', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"planSnapshotId":"snapshot-1"'),
    }))
    expect(String(apiFetchMock.mock.calls[0]?.[1]?.body)).not.toContain('confirmed')
  })

  it('fails locally when the plan has no persisted identity', async () => {
    await expect(issueOperationApprovalGrant(plan())).rejects.toThrow('OPERATION_PLAN_SNAPSHOT_ID_REQUIRED')
    expect(apiFetchMock).not.toHaveBeenCalled()
  })
})
