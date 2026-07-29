import { parsePhoneNumberFromString } from 'libphonenumber-js/core'
import phoneMetadata from 'libphonenumber-js/metadata.min'
import {
  getSmsDestination,
  getSmsDestinationByCountryCode,
  type SmsDestination,
  type SmsDestinationId,
} from '@/lib/auth/sms-destinations'

const CHINA_MAINLAND_WITH_COUNTRY_CODE_PATTERN = /^86[1-9]\d{10}$/
const CHINA_MAINLAND_MOBILE_PATTERN = /^1[3-9]\d{9}$/

function normalizeDialingPrefix(value: string, destinationId?: SmsDestinationId): string {
  const compact = value.trim().replace(/[\s().-]/g, '')
  if (compact.startsWith('00')) return `+${compact.slice(2)}`
  if (
    destinationId === 'CN'
    && CHINA_MAINLAND_WITH_COUNTRY_CODE_PATTERN.test(compact)
  ) {
    return `+${compact}`
  }
  return compact
}

export function normalizePhoneNumberForDestination(
  value: unknown,
  destinationId: SmsDestinationId,
): string | null {
  if (typeof value !== 'string') return null
  const candidate = normalizeDialingPrefix(value, destinationId)
  if (!candidate) return null

  const destination = getSmsDestination(destinationId)
  const parsed = parsePhoneNumberFromString(candidate, {
    defaultCountry: destination.countryCode,
    extract: false,
  }, phoneMetadata)
  if (!parsed?.isValid() || parsed.country !== destination.countryCode) return null
  return String(parsed.number)
}

export function normalizePhoneNumber(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const candidate = normalizeDialingPrefix(value)
  if (!candidate) return null

  if (!candidate.startsWith('+')) {
    if (
      !CHINA_MAINLAND_MOBILE_PATTERN.test(candidate)
      && !CHINA_MAINLAND_WITH_COUNTRY_CODE_PATTERN.test(candidate)
    ) {
      return null
    }
    return normalizePhoneNumberForDestination(candidate, 'CN')
  }

  const parsed = parsePhoneNumberFromString(candidate, { extract: false }, phoneMetadata)
  if (!parsed?.isValid() || !getSmsDestinationByCountryCode(parsed.country)) return null
  return String(parsed.number)
}

export function resolveSmsDestinationFromPhoneNumber(
  value: unknown,
): SmsDestination | null {
  const phoneNumber = normalizePhoneNumber(value)
  if (!phoneNumber) return null
  const parsed = parsePhoneNumberFromString(phoneNumber, { extract: false }, phoneMetadata)
  return getSmsDestinationByCountryCode(parsed?.country)
}

export function maskPhoneNumber(phoneNumber: string): string {
  if (phoneNumber.length <= 8) return phoneNumber
  return `${phoneNumber.slice(0, 5)}****${phoneNumber.slice(-4)}`
}
