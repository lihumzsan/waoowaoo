import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PROFILE_ACTION_KEY_LIST } from '@/lib/profile/billing-transaction-display'
import { getProfileTransactionKindTranslationKey } from '@/lib/profile/transaction-labels'

const ROOT = process.cwd()

function readProfileMessages(locale: 'en' | 'zh'): { raw: string; parsed: Record<string, unknown> } {
  const raw = readFileSync(join(ROOT, 'messages', locale, 'profile.json'), 'utf8')
  const parsed = JSON.parse(raw) as Record<string, unknown>
  return { raw, parsed }
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('PROFILE_MESSAGE_RECORD_EXPECTED')
  }
  return value as Record<string, unknown>
}

describe('profile transaction labels', () => {
  it('keeps recharge transaction labels outside the profile.recharge object namespace', () => {
    expect(getProfileTransactionKindTranslationKey('consume')).toBe('transactionKinds.consume')
    expect(getProfileTransactionKindTranslationKey('shadow_consume')).toBe('transactionKinds.consume')
    expect(getProfileTransactionKindTranslationKey('recharge')).toBe('transactionKinds.recharge')
    expect(getProfileTransactionKindTranslationKey('grant')).toBe('transactionKinds.recharge')

    for (const locale of ['zh', 'en'] as const) {
      const { raw, parsed } = readProfileMessages(locale)
      const transactionKinds = readRecord(parsed.transactionKinds)

      expect(raw.match(/^  "recharge":/gm)).toHaveLength(1)
      expect(typeof parsed.recharge).toBe('object')
      expect(typeof transactionKinds.recharge).toBe('string')
      expect(typeof transactionKinds.consume).toBe('string')
    }
  })

  it('covers every supported account transaction action with localized labels', () => {
    for (const locale of ['zh', 'en'] as const) {
      const { parsed } = readProfileMessages(locale)
      const actionTypes = readRecord(parsed.actionTypes)
      for (const actionKey of PROFILE_ACTION_KEY_LIST) {
        expect(actionTypes[actionKey], `${locale} profile.actionTypes.${actionKey}`).toEqual(expect.any(String))
      }
    }
  })
})
