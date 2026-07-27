import { describe, expect, it } from 'vitest'
import { maskPhoneNumber, normalizePhoneNumber } from '@/lib/auth/phone-number'

describe('phone canonical identity', () => {
  it('normalizes mainland China input variants to one E.164 identity', () => {
    expect(normalizePhoneNumber('138 0013 8000')).toBe('+8613800138000')
    expect(normalizePhoneNumber('86-138-0013-8000')).toBe('+8613800138000')
    expect(normalizePhoneNumber('0086 13800138000')).toBe('+8613800138000')
    expect(normalizePhoneNumber('+86 (138) 0013-8000')).toBe('+8613800138000')
  })

  it('preserves valid international E.164 identities and rejects ambiguous input', () => {
    expect(normalizePhoneNumber('+14155552671')).toBe('+14155552671')
    expect(normalizePhoneNumber('4155552671')).toBeNull()
    expect(normalizePhoneNumber('+0123456789')).toBeNull()
    expect(normalizePhoneNumber('not-a-phone')).toBeNull()
  })

  it('masks phone identities before authentication logging', () => {
    expect(maskPhoneNumber('+8613800138000')).toBe('+8613****8000')
  })
})
