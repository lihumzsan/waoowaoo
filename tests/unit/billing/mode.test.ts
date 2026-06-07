import { afterEach, describe, expect, it } from 'vitest'
import { getBillingMode, getBootBillingEnabled } from '@/lib/billing/mode'

const ORIGINAL_ENV = {
  BILLING_MODE: process.env.BILLING_MODE,
  DEPLOYMENT_EDITION: process.env.DEPLOYMENT_EDITION,
  PROVIDER_CREDENTIAL_MODE: process.env.PROVIDER_CREDENTIAL_MODE,
}

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

describe('billing/mode', () => {
  afterEach(() => restoreEnv())

  it('falls back to OFF when env is missing', async () => {
    delete process.env.DEPLOYMENT_EDITION
    delete process.env.PROVIDER_CREDENTIAL_MODE
    delete process.env.BILLING_MODE
    await expect(getBillingMode()).resolves.toBe('OFF')
    expect(getBootBillingEnabled()).toBe(false)
  })

  it('normalizes lower-case env mode', async () => {
    process.env.BILLING_MODE = 'enforce'
    await expect(getBillingMode()).resolves.toBe('ENFORCE')
    expect(getBootBillingEnabled()).toBe(true)
  })

  it('fails explicitly when env mode is invalid', async () => {
    process.env.BILLING_MODE = 'invalid'
    await expect(getBillingMode()).rejects.toThrow('BILLING_MODE_INVALID')
    expect(() => getBootBillingEnabled()).toThrow('BILLING_MODE_INVALID')
  })

  it('requires ENFORCE in cloud mode', async () => {
    process.env.DEPLOYMENT_EDITION = 'cloud'
    process.env.PROVIDER_CREDENTIAL_MODE = 'platform-key'
    process.env.BILLING_MODE = 'OFF'

    await expect(getBillingMode()).rejects.toThrow('BILLING_MODE_CLOUD_REQUIRES_ENFORCE')
    expect(() => getBootBillingEnabled()).toThrow('BILLING_MODE_CLOUD_REQUIRES_ENFORCE')
  })

  it('requires explicit billing mode in cloud mode', async () => {
    process.env.DEPLOYMENT_EDITION = 'cloud'
    process.env.PROVIDER_CREDENTIAL_MODE = 'platform-key'
    delete process.env.BILLING_MODE

    await expect(getBillingMode()).rejects.toThrow('BILLING_MODE_REQUIRED_FOR_CLOUD')
  })
})
