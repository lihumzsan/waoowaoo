const LOCALE_PATH_PATTERN = /^\/(zh|en)(\/|$)/

export const API_AUTH_REQUIRED_EVENT = 'waoowaoo:auth-required'

function resolveLocaleFromPath(pathname: string): string {
  const match = pathname.match(LOCALE_PATH_PATTERN)
  return match?.[1] ?? 'zh'
}

export function getPageLocale(): string {
  if (typeof window === 'undefined') return 'zh'
  return resolveLocaleFromPath(window.location.pathname)
}

function resolveRequestPathname(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    if (input.startsWith('/')) return input
    try {
      return new URL(input).pathname
    } catch {
      return ''
    }
  }

  if (input instanceof URL) {
    return input.pathname
  }

  try {
    return new URL(input.url).pathname
  } catch {
    return ''
  }
}

function shouldInjectLocaleHeader(input: RequestInfo | URL): boolean {
  const pathname = resolveRequestPathname(input)
  return pathname === '/api' || pathname.startsWith('/api/')
}

export function mergeLocaleHeader(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers)
  if (!headers.has('Accept-Language')) {
    headers.set('Accept-Language', getPageLocale())
  }
  return { ...init, headers }
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const isApiRequest = shouldInjectLocaleHeader(input)
  const response = await fetch(input, isApiRequest ? mergeLocaleHeader(init) : init)
  if (
    isApiRequest
    && response.status === 401
    && typeof window !== 'undefined'
    && resolveRequestPathname(input) !== '/api/auth/session'
  ) {
    window.dispatchEvent(new Event(API_AUTH_REQUIRED_EVENT))
  }
  return response
}
