export const DEFAULT_USER_TIME_ZONE = 'Asia/Shanghai'

/**
 * Billing timestamps are persisted as absolute UTC instants. The browser's
 * IANA zone is only a display input; if it is unavailable, the product's
 * default display zone is used instead of inheriting the server container's
 * UTC zone.
 */
export function resolveBrowserUserTimeZone(): string {
  try {
    const timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone?.trim()
    if (!timeZone) return DEFAULT_USER_TIME_ZONE

    // resolvedOptions should already return an IANA zone. Validate at the
    // formatter boundary so an unusual runtime cannot break the billing View.
    new Intl.DateTimeFormat('en', { timeZone }).format(new Date(0))
    return timeZone
  } catch {
    return DEFAULT_USER_TIME_ZONE
  }
}
