interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'DELETE' | 'PATCH' | 'PUT'
  readonly headers?: Record<string, string>
  readonly body?: BodyInit | null
}

export interface JsonResponse<T> {
  readonly response: Response
  readonly data: T
}

class CookieJar {
  private readonly cookies = new Map<string, string>()

  seed(cookieHeader: string): void {
    for (const item of cookieHeader.split(';')) {
      const equalsIndex = item.indexOf('=')
      if (equalsIndex <= 0) continue
      const name = item.slice(0, equalsIndex).trim()
      const value = item.slice(equalsIndex + 1).trim()
      if (name && value) this.cookies.set(name, value)
    }
  }

  storeSetCookie(line: string): void {
    const firstSegment = line.split(';')[0] ?? ''
    const equalsIndex = firstSegment.indexOf('=')
    if (equalsIndex <= 0) return
    const name = firstSegment.slice(0, equalsIndex).trim()
    const value = firstSegment.slice(equalsIndex + 1).trim()
    if (!name) return
    if (!value) {
      this.cookies.delete(name)
      return
    }
    this.cookies.set(name, value)
  }

  header(): string | null {
    const items = [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`)
    return items.length > 0 ? items.join('; ') : null
  }
}

function readSetCookieLines(headers: Headers): string[] {
  const extendedHeaders = headers as Headers & { getSetCookie?: () => string[] }
  const direct = extendedHeaders.getSetCookie?.()
  if (direct && direct.length > 0) return direct
  const combined = headers.get('set-cookie')
  if (!combined) return []
  return combined.split(/,(?=[^;,]+=)/).map((line) => line.trim()).filter(Boolean)
}

async function readResponseBody(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

export class E2eHttpClient {
  private readonly jar = new CookieJar()

  constructor(private readonly baseUrl: string) {}

  seedCookie(cookieHeader: string): void {
    this.jar.seed(cookieHeader)
  }

  async request(pathname: string, options: RequestOptions = {}): Promise<Response> {
    const headers = new Headers(options.headers)
    const cookie = this.jar.header()
    if (cookie) headers.set('cookie', cookie)
    const response = await fetch(new URL(pathname, this.baseUrl), {
      method: options.method ?? 'GET',
      headers,
      body: options.body ?? null,
      redirect: 'manual',
    })
    for (const line of readSetCookieLines(response.headers)) {
      this.jar.storeSetCookie(line)
    }
    return response
  }

  async json<T>(pathname: string, options: RequestOptions = {}): Promise<JsonResponse<T>> {
    const response = await this.request(pathname, options)
    const text = await readResponseBody(response)
    if (!response.ok) {
      throw new Error(`E2E_HTTP_${response.status}:${pathname}:${text}`)
    }
    try {
      return {
        response,
        data: JSON.parse(text) as T,
      }
    } catch {
      throw new Error(`E2E_HTTP_JSON_INVALID:${pathname}:${text.slice(0, 500)}`)
    }
  }

  async postJson<T>(pathname: string, body: Record<string, unknown>): Promise<JsonResponse<T>> {
    return await this.json<T>(pathname, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  async postForm<T>(pathname: string, body: URLSearchParams): Promise<JsonResponse<T>> {
    return await this.json<T>(pathname, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    })
  }

  async postStream(pathname: string, body: Record<string, unknown>): Promise<string> {
    const response = await this.request(pathname, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const text = await readResponseBody(response)
    if (!response.ok) {
      throw new Error(`E2E_HTTP_${response.status}:${pathname}:${text}`)
    }
    return text
  }
}

function readStringField(value: unknown, field: string): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`E2E_AUTH_FIELD_MISSING:${field}`)
  }
  const record = value as Record<string, unknown>
  const fieldValue = record[field]
  if (typeof fieldValue !== 'string' || !fieldValue.trim()) {
    throw new Error(`E2E_AUTH_FIELD_MISSING:${field}`)
  }
  return fieldValue
}

export async function authenticateE2eClient(input: {
  readonly client: E2eHttpClient
  readonly baseUrl: string
  readonly username: string | null
  readonly password: string | null
  readonly sessionCookie: string | null
}): Promise<void> {
  if (input.sessionCookie) {
    input.client.seedCookie(input.sessionCookie)
    return
  }
  if (!input.username || !input.password) {
    throw new Error('E2E_AUTH_REQUIRED: provide E2E_SESSION_COOKIE or E2E_USERNAME/E2E_PASSWORD')
  }
  const csrf = await input.client.json<unknown>('/api/auth/csrf')
  const csrfToken = readStringField(csrf.data, 'csrfToken')
  const body = new URLSearchParams({
    csrfToken,
    username: input.username,
    password: input.password,
    redirect: 'false',
    json: 'true',
    callbackUrl: input.baseUrl,
  })
  await input.client.postForm<unknown>('/api/auth/callback/credentials', body)
}
