const E164_PHONE_PATTERN = /^\+[1-9]\d{7,14}$/
const CHINA_MAINLAND_PHONE_PATTERN = /^1[3-9]\d{9}$/

export function normalizePhoneNumber(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const compact = value.trim().replace(/[\s()-]/g, '')
  if (!compact) return null

  if (CHINA_MAINLAND_PHONE_PATTERN.test(compact)) {
    return `+86${compact}`
  }

  if (compact.startsWith('0086') && CHINA_MAINLAND_PHONE_PATTERN.test(compact.slice(4))) {
    return `+86${compact.slice(4)}`
  }

  if (compact.startsWith('86') && CHINA_MAINLAND_PHONE_PATTERN.test(compact.slice(2))) {
    return `+${compact}`
  }

  return E164_PHONE_PATTERN.test(compact) ? compact : null
}

export function maskPhoneNumber(phoneNumber: string): string {
  if (phoneNumber.length <= 8) return phoneNumber
  return `${phoneNumber.slice(0, 5)}****${phoneNumber.slice(-4)}`
}
