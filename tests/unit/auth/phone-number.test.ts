import { describe, expect, it } from 'vitest'
import {
  maskPhoneNumber,
  normalizePhoneNumber,
  normalizePhoneNumberForDestination,
  resolveSmsDestinationFromPhoneNumber,
} from '@/lib/auth/phone-number'
import { SMS_DESTINATIONS } from '@/lib/auth/sms-destinations'

describe('phone canonical identity', () => {
  it('normalizes mainland China input variants to one E.164 identity', () => {
    expect(normalizePhoneNumber('138 0013 8000')).toBe('+8613800138000')
    expect(normalizePhoneNumber('86-138-0013-8000')).toBe('+8613800138000')
    expect(normalizePhoneNumber('0086 13800138000')).toBe('+8613800138000')
    expect(normalizePhoneNumber('+86 (138) 0013-8000')).toBe('+8613800138000')
  })

  it('rejects international, ambiguous, or malformed input when only mainland China is enabled', () => {
    expect(normalizePhoneNumber('+447400123456')).toBeNull()
    expect(normalizePhoneNumber('4155552671')).toBeNull()
    expect(normalizePhoneNumber('+14155552671')).toBeNull()
    expect(normalizePhoneNumber('+33123456789')).toBeNull()
    expect(normalizePhoneNumber('+0123456789')).toBeNull()
    expect(normalizePhoneNumber('not-a-phone')).toBeNull()
  })

  it('normalizes every production destination example back to its registry identity', () => {
    for (const destination of SMS_DESTINATIONS) {
      const phoneNumber = normalizePhoneNumberForDestination(
        destination.exampleNationalNumber,
        destination.id,
      )
      expect(phoneNumber, destination.id).not.toBeNull()
      expect(resolveSmsDestinationFromPhoneNumber(phoneNumber)?.id).toBe(destination.id)
    }
  })

  it('masks phone identities before authentication logging', () => {
    expect(maskPhoneNumber('+8613800138000')).toBe('+8613****8000')
  })
})
