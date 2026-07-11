import { describe, expect, it } from 'vitest'
import { inspectSingleTaskBillingOwner } from '../../../scripts/guards/single-task-billing-owner-guard.mjs'

const valid = {
  service: 'prepareTaskBillingInTransaction settleTaskBillingInTransaction rollbackTaskBillingInTransaction if (getLogContext().taskId) return await execute()',
  index: 'settleTaskBillingInTransaction',
  terminal: 'settleTaskBillingInTransaction rollbackTaskBillingInTransaction',
  transactionalCreate: 'prepareTaskBillingInTransaction',
}

describe('single Task billing owner guard', () => {
  it('accepts transaction-only Task billing', () => {
    expect(inspectSingleTaskBillingOwner(valid)).toEqual([])
  })

  it('rejects a restored non-transaction writer', () => {
    expect(inspectSingleTaskBillingOwner({
      ...valid,
      service: `${valid.service}\nexport async function settleTaskBilling() {}`,
      index: `${valid.index}\n  settleTaskBilling,`,
    })).toEqual(expect.arrayContaining([
      expect.stringContaining('non-transaction Task billing writer'),
      expect.stringContaining('must not export legacy Task writer'),
    ]))
  })
})
