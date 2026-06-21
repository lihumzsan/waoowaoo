import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  OFFICIAL_CONTENT_DIR_ENV,
  readOfficialContactPage,
  readOfficialLegalPage,
  readOfficialPricingPage,
} from '@/lib/public-site/official-content'

const ORIGINAL_CONTENT_DIR = process.env[OFFICIAL_CONTENT_DIR_ENV]

function writeJson(dir: string, fileName: string, value: unknown): void {
  writeFileSync(path.join(dir, fileName), JSON.stringify(value), 'utf8')
}

function writeCompleteContent(dir: string): void {
  writeJson(dir, 'pricing.zh.json', {
    eyebrow: 'Pricing',
    title: 'Official pricing',
    description: 'Private pricing content',
    betaNotice: 'Checkout is not enabled.',
    checkout: {
      title: 'Top up',
      body: 'Use live checkout',
      primaryCta: 'Top up now',
      secondaryCta: 'Create account',
    },
    plans: {
      starter: {
        label: 'Starter label',
        name: 'Starter',
        price: 'USD 10',
        status: 'Available soon',
        details: ['100 credits', 'Email support'],
      },
    },
    creditPolicy: {
      title: 'Credit rules',
      body: 'Private credit rules',
    },
  })

  writeJson(dir, 'contact.zh.json', {
    eyebrow: 'Merchant',
    title: 'Merchant info',
    description: 'Private merchant content',
    publicInfo: {
      title: 'Public merchant fields',
      fields: [
        { label: 'Legal name', value: 'Example Private Company Limited' },
        { label: 'Support email', value: 'support@example.test' },
      ],
    },
    portalOnly: {
      title: 'Portal-only documents',
      description: 'Do not publish these documents.',
      items: ['Certificate scan', 'Director KYC'],
    },
  })

  writeJson(dir, 'terms.zh.json', {
    eyebrow: 'Legal',
    title: 'Terms',
    description: 'Private terms',
    updatedAt: 'Last updated today',
    sections: [
      { title: 'Merchant', body: 'Private merchant terms' },
    ],
  })
}

describe('official public-site content', () => {
  let tempDir = ''

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'official-content-'))
    process.env[OFFICIAL_CONTENT_DIR_ENV] = tempDir
  })

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true })
    if (ORIGINAL_CONTENT_DIR === undefined) {
      delete process.env[OFFICIAL_CONTENT_DIR_ENV]
    } else {
      process.env[OFFICIAL_CONTENT_DIR_ENV] = ORIGINAL_CONTENT_DIR
    }
  })

  it('loads pricing, contact, and legal content from the private content directory', () => {
    writeCompleteContent(tempDir)

    const pricing = readOfficialPricingPage('zh')
    const contact = readOfficialContactPage('zh')
    const terms = readOfficialLegalPage('terms', 'zh')

    expect(pricing.plans).toHaveLength(1)
    expect(pricing.plans[0].price).toBe('USD 10')
    expect(pricing.checkout.primaryCta).toBe('Top up now')
    expect(contact.publicInfo.fields[0].value).toBe('Example Private Company Limited')
    expect(contact.portalOnly.items).toEqual(['Certificate scan', 'Director KYC'])
    expect(terms.sections[0]).toEqual({
      title: 'Merchant',
      body: 'Private merchant terms',
    })
  })

  it('fails explicitly when a required private content file is missing', () => {
    expect(() => readOfficialPricingPage('zh')).toThrow('OFFICIAL_CONTENT_FILE_MISSING')
  })

  it('fails explicitly when private content schema is invalid', () => {
    writeJson(tempDir, 'pricing.zh.json', {
      eyebrow: 'Pricing',
      title: 'Official pricing',
      description: 'Private pricing content',
      betaNotice: 'Checkout is not enabled.',
      checkout: {
        title: 'Top up',
        body: 'Use live checkout',
        primaryCta: 'Top up now',
        secondaryCta: 'Create account',
      },
      plans: {},
      creditPolicy: {
        title: 'Credit rules',
        body: 'Private credit rules',
      },
    })

    expect(() => readOfficialPricingPage('zh')).toThrow('OFFICIAL_CONTENT_INVALID')
  })
})
