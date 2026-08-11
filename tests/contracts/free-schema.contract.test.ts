import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('free product schema contract', () => {
  it('contains lifecycle entities but no billing-owned models or fields', () => {
    const schema = readFileSync(path.resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8')
    for (const model of [
      'UsageCost', 'UserBalance', 'LlmBillingMeter', 'Subscription', 'SubscriptionGrant',
      'BalanceFreeze', 'BalanceTransaction', 'PaidBetaCampaign', 'PaidBetaSeat',
      'PaidBetaPaymentAttempt',
    ]) {
      expect(schema).not.toMatch(new RegExp(`\\bmodel\\s+${model}\\b`))
    }
    for (const field of [
      'assistantBillingConfirmationRequired', 'billingInfo', 'billedAt',
      'quoteSnapshot', 'quoteHash', 'quoteCeiling',
    ]) {
      expect(schema).not.toMatch(new RegExp(`^\\s*${field}\\s+`, 'mu'))
    }
    for (const model of ['User', 'Project', 'Task', 'OperationPlanSnapshot', 'ApprovalGrant', 'OperationExecution']) {
      expect(schema).toMatch(new RegExp(`\\bmodel\\s+${model}\\b`))
    }
  })
})
