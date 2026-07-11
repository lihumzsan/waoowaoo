import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withLogContext } from '@/lib/logging/context'
import { recordTextUsage, withTextUsageCollection } from '@/lib/billing/runtime-usage'

const modeMock = vi.hoisted(() => ({
  getBillingMode: vi.fn(async () => {
    throw new Error('TASK_SYNC_BILLING_MUST_NOT_READ_MODE')
  }),
}))

vi.mock('@/lib/billing/mode', () => modeMock)

import { withTextBilling } from '@/lib/billing/service'

describe('Task runtime billing ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('leaves Task charging to Terminal Service and preserves outer usage collection', async () => {
    const collected = await withLogContext({ taskId: 'task-billing-owner' }, async () => (
      await withTextUsageCollection(async () => await withTextBilling(
        'user-1',
        'provider::model',
        1_000,
        { projectId: 'project-1', action: 'task-text-step' },
        async () => {
          recordTextUsage({ model: 'provider::model', inputTokens: 12, outputTokens: 7 })
          return { text: 'ok' }
        },
      ))
    ))

    expect(collected).toEqual({
      result: { text: 'ok' },
      textUsage: [{ model: 'provider::model', inputTokens: 12, outputTokens: 7 }],
    })
    expect(modeMock.getBillingMode).not.toHaveBeenCalled()
  })
})
