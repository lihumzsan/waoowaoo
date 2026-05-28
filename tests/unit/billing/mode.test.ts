import { describe, expect, it } from 'vitest'
import { getBillingMode, getBootBillingEnabled } from '@/lib/billing/mode'

describe('billing/mode disabled mode', () => {
  it('always reports OFF even when BILLING_MODE asks for enforcement', async () => {
    process.env.BILLING_MODE = 'ENFORCE'
    await expect(getBillingMode()).resolves.toBe('OFF')
    expect(getBootBillingEnabled()).toBe(false)
  })

  it('always reports OFF for shadow or invalid mode', async () => {
    process.env.BILLING_MODE = 'SHADOW'
    await expect(getBillingMode()).resolves.toBe('OFF')
    process.env.BILLING_MODE = 'invalid'
    await expect(getBillingMode()).resolves.toBe('OFF')
    expect(getBootBillingEnabled()).toBe(false)
  })
})
