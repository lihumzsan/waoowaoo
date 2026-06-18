import { afterEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

async function loadModule() {
  vi.resetModules()
  return await import('@/lib/payments/recharge-config')
}

function resetEnv() {
  process.env = { ...ORIGINAL_ENV }
}

describe('payments/recharge-config', () => {
  afterEach(() => {
    resetEnv()
    vi.resetModules()
  })

  it('keeps self-hosted deployments disabled without payment env', async () => {
    delete process.env.DEPLOYMENT_EDITION
    delete process.env.PAYMENT_MIN_CREDITS
    delete process.env.PAYMENT_MAX_CREDITS
    delete process.env.PAYMENT_CNY_TO_HKD_RATE

    const { getRechargeConfig } = await loadModule()

    expect(getRechargeConfig()).toEqual({
      enabled: false,
      creditValueCurrency: 'CNY',
      settlementCurrency: 'HKD',
      minCredits: 0,
      maxCredits: 0,
      cnyToHkdRate: 0,
    })
  })

  it('requires explicit cloud payment bounds and rate', async () => {
    process.env.DEPLOYMENT_EDITION = 'cloud'
    process.env.PROVIDER_CREDENTIAL_MODE = 'platform-key'
    process.env.BILLING_MODE = 'ENFORCE'
    delete process.env.PAYMENT_MIN_CREDITS
    process.env.PAYMENT_MAX_CREDITS = '1000'
    process.env.PAYMENT_CNY_TO_HKD_RATE = '1.1'

    const { getRechargeConfig } = await loadModule()

    expect(() => getRechargeConfig()).toThrow('PAYMENT_MIN_CREDITS_REQUIRED')
  })

  it('quotes CNY-valued credits into HKD settlement cents', async () => {
    process.env.DEPLOYMENT_EDITION = 'cloud'
    process.env.PROVIDER_CREDENTIAL_MODE = 'platform-key'
    process.env.BILLING_MODE = 'ENFORCE'
    process.env.PAYMENT_MIN_CREDITS = '5'
    process.env.PAYMENT_MAX_CREDITS = '1000'
    process.env.PAYMENT_CNY_TO_HKD_RATE = '1.1'

    const { getRechargeConfig, quoteRecharge } = await loadModule()
    const config = getRechargeConfig()

    expect(config.enabled).toBe(true)
    expect(quoteRecharge(88.88, config)).toEqual({
      credits: 88.88,
      settlementAmount: 97.77,
      settlementUnitAmount: 9777,
      creditValueCurrency: 'CNY',
      settlementCurrency: 'HKD',
      cnyToHkdRate: 1.1,
    })
  })

  it('rejects out-of-range custom credit amounts', async () => {
    process.env.DEPLOYMENT_EDITION = 'cloud'
    process.env.PROVIDER_CREDENTIAL_MODE = 'platform-key'
    process.env.BILLING_MODE = 'ENFORCE'
    process.env.PAYMENT_MIN_CREDITS = '5'
    process.env.PAYMENT_MAX_CREDITS = '1000'
    process.env.PAYMENT_CNY_TO_HKD_RATE = '1.1'

    const { getRechargeConfig, quoteRecharge } = await loadModule()
    const config = getRechargeConfig()

    expect(() => quoteRecharge(4.99, config)).toThrow('PAYMENT_CREDITS_BELOW_MIN')
    expect(() => quoteRecharge(1000.01, config)).toThrow('PAYMENT_CREDITS_ABOVE_MAX')
  })
})
