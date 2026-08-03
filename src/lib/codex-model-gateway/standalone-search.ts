import {
  readRequestBufferWithLimit,
  readResponseBufferWithLimit,
} from '@/lib/http/body-limits'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'
import {
  CODEX_MODEL_GATEWAY_ASSISTANT_ID,
  CodexModelGatewayError,
} from './contracts'
import { resolveCodexModelGatewayUpstream } from './selection'
import { requireCodexModelGatewayActiveTurn } from './active-turn-guard'

const SEARCH_REQUEST_MAX_BYTES = 4 * 1024 * 1024
const SEARCH_RESPONSE_MAX_BYTES = 8 * 1024 * 1024
const MAX_SEARCH_QUERIES = 4

type SearchQuery = {
  readonly q: string
  readonly recency: number | null
  readonly domains: readonly string[]
}

type SearchRequest = {
  readonly model: string
  readonly queries: readonly SearchQuery[]
  readonly contextSize: 'low' | 'medium' | 'high'
  readonly allowedDomains: readonly string[]
  readonly userLocation: Readonly<Record<string, string>> | null
  readonly maxOutputTokens: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assertOnlyKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  code: string,
): void {
  const keys = new Set(allowed)
  if (Object.keys(record).some((key) => !keys.has(key))) {
    throw new CodexModelGatewayError(code as 'SEARCH_COMMAND_UNSUPPORTED', 422)
  }
}

function requireString(value: unknown, code: 'SEARCH_QUERY_INVALID'): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new CodexModelGatewayError(code, 422)
  }
  return value.trim()
}

function readStringArray(value: unknown): readonly string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > 20) {
    throw new CodexModelGatewayError('SEARCH_QUERY_INVALID', 422)
  }
  return value.map((item) => requireString(item, 'SEARCH_QUERY_INVALID'))
}

function readQueries(value: unknown): readonly SearchQuery[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_SEARCH_QUERIES) {
    throw new CodexModelGatewayError('SEARCH_QUERY_INVALID', 422)
  }
  return value.map((entry) => {
    if (!isRecord(entry)) throw new CodexModelGatewayError('SEARCH_QUERY_INVALID', 422)
    assertOnlyKeys(entry, ['q', 'recency', 'domains'], 'SEARCH_QUERY_INVALID')
    const recencyValue = entry.recency
    const recency = recencyValue === undefined || recencyValue === null
      ? null
      : typeof recencyValue === 'number'
        ? recencyValue
        : Number.NaN
    if (recency !== null && (!Number.isSafeInteger(recency) || recency < 1 || recency > 3650)) {
      throw new CodexModelGatewayError('SEARCH_QUERY_INVALID', 422)
    }
    return {
      q: requireString(entry.q, 'SEARCH_QUERY_INVALID'),
      recency,
      domains: readStringArray(entry.domains),
    }
  })
}

function readLocation(value: unknown): Readonly<Record<string, string>> | null {
  if (value === undefined || value === null) return null
  if (!isRecord(value)) throw new CodexModelGatewayError('SEARCH_QUERY_INVALID', 422)
  assertOnlyKeys(value, ['type', 'country', 'region', 'city', 'timezone'], 'SEARCH_QUERY_INVALID')
  if (value.type !== 'approximate') {
    throw new CodexModelGatewayError('SEARCH_QUERY_INVALID', 422)
  }
  const result: Record<string, string> = { type: 'approximate' }
  for (const key of ['country', 'region', 'city', 'timezone'] as const) {
    if (value[key] === undefined || value[key] === null) continue
    result[key] = requireString(value[key], 'SEARCH_QUERY_INVALID')
  }
  return result
}

function parseSearchRequest(value: unknown): SearchRequest {
  if (!isRecord(value)) throw new CodexModelGatewayError('SEARCH_QUERY_INVALID', 422)
  assertOnlyKeys(
    value,
    ['id', 'model', 'reasoning', 'input', 'commands', 'settings', 'max_output_tokens'],
    'SEARCH_QUERY_INVALID',
  )
  if (!isRecord(value.commands)) {
    throw new CodexModelGatewayError('SEARCH_QUERY_INVALID', 422)
  }
  assertOnlyKeys(value.commands, ['search_query', 'response_length'], 'SEARCH_COMMAND_UNSUPPORTED')
  const queries = readQueries(value.commands.search_query)

  const settings = value.settings === undefined || value.settings === null
    ? {}
    : value.settings
  if (!isRecord(settings)) throw new CodexModelGatewayError('SEARCH_QUERY_INVALID', 422)
  assertOnlyKeys(
    settings,
    [
      'user_location',
      'search_context_size',
      'filters',
      'image_settings',
      'allowed_callers',
      'external_web_access',
    ],
    'SEARCH_QUERY_INVALID',
  )
  if (settings.image_settings !== undefined && settings.image_settings !== null) {
    throw new CodexModelGatewayError('SEARCH_COMMAND_UNSUPPORTED', 422)
  }
  const contextSize = settings.search_context_size ?? 'medium'
  if (contextSize !== 'low' && contextSize !== 'medium' && contextSize !== 'high') {
    throw new CodexModelGatewayError('SEARCH_QUERY_INVALID', 422)
  }
  const filters = settings.filters === undefined || settings.filters === null
    ? {}
    : settings.filters
  if (!isRecord(filters)) throw new CodexModelGatewayError('SEARCH_QUERY_INVALID', 422)
  assertOnlyKeys(filters, ['allowed_domains', 'blocked_domains'], 'SEARCH_QUERY_INVALID')
  if (Array.isArray(filters.blocked_domains) && filters.blocked_domains.length > 0) {
    throw new CodexModelGatewayError('SEARCH_COMMAND_UNSUPPORTED', 422)
  }
  const requestedTokens = value.max_output_tokens
  const maxOutputTokens = typeof requestedTokens === 'number' && Number.isSafeInteger(requestedTokens)
    ? Math.min(Math.max(requestedTokens, 512), 4_000)
    : 2_500
  return {
    model: requireString(value.model, 'SEARCH_QUERY_INVALID'),
    queries,
    contextSize,
    allowedDomains: readStringArray(filters.allowed_domains),
    userLocation: readLocation(settings.user_location),
    maxOutputTokens,
  }
}

function buildSearchPrompt(queries: readonly SearchQuery[]): string {
  const lines = queries.map((query, index) => {
    const qualifiers = [
      query.recency ? `within the last ${String(query.recency)} days` : null,
      query.domains.length > 0 ? `domains: ${query.domains.join(', ')}` : null,
    ].filter((value): value is string => value !== null)
    return `${String(index + 1)}. ${query.q}${qualifiers.length ? ` (${qualifiers.join('; ')})` : ''}`
  })
  return [
    'Use the provided web-search server tool now for every query below.',
    'Return a concise factual synthesis grounded only in the retrieved sources, with URL citations.',
    ...lines,
  ].join('\n')
}

function maxResults(contextSize: SearchRequest['contextSize']): number {
  if (contextSize === 'low') return 3
  if (contextSize === 'high') return 8
  return 5
}

function buildOpenRouterSearchBody(
  input: SearchRequest,
  upstreamModelId: string,
): Record<string, unknown> {
  const domainSet = new Set([
    ...input.allowedDomains,
    ...input.queries.flatMap((query) => query.domains),
  ])
  const parameters: Record<string, unknown> = {
    engine: 'auto',
    max_results: maxResults(input.contextSize),
    max_total_results: Math.min(maxResults(input.contextSize) * input.queries.length, 20),
    search_context_size: input.contextSize,
  }
  if (domainSet.size > 0) parameters.allowed_domains = [...domainSet]
  if (input.userLocation) parameters.user_location = input.userLocation
  return {
    model: upstreamModelId,
    input: buildSearchPrompt(input.queries),
    tools: [{ type: 'openrouter:web_search', parameters }],
    max_output_tokens: input.maxOutputTokens,
    stream: false,
  }
}

type SearchProjection = {
  readonly output: string
  readonly results: readonly Record<string, unknown>[]
}

function projectOpenRouterSearchResponse(value: unknown): SearchProjection {
  if (!isRecord(value) || value.status !== 'completed' || !Array.isArray(value.output)) {
    throw new CodexModelGatewayError('PROVIDER_SEARCH_RESPONSE_INVALID', 502)
  }
  const textParts: string[] = []
  const citations = new Map<string, Record<string, unknown>>()
  for (const item of value.output) {
    if (!isRecord(item) || item.type !== 'message' || !Array.isArray(item.content)) continue
    for (const content of item.content) {
      if (!isRecord(content) || content.type !== 'output_text' || typeof content.text !== 'string') continue
      const text = content.text.trim()
      if (text) textParts.push(text)
      if (!Array.isArray(content.annotations)) continue
      for (const annotation of content.annotations) {
        if (!isRecord(annotation) || annotation.type !== 'url_citation') continue
        const url = typeof annotation.url === 'string' ? annotation.url.trim() : ''
        if (!url || citations.has(url)) continue
        try {
          const parsed = new URL(url)
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue
        } catch {
          continue
        }
        const index = citations.size
        citations.set(url, {
          type: 'text_result',
          ref_id: `turn0search${String(index)}`,
          url,
          ...(typeof annotation.title === 'string' && annotation.title.trim()
            ? { title: annotation.title.trim() }
            : {}),
          ...(typeof annotation.content === 'string' && annotation.content.trim()
            ? { snippet: annotation.content.trim() }
            : {}),
        })
      }
    }
  }
  const output = textParts.join('\n\n').trim()
  if (!output) throw new CodexModelGatewayError('PROVIDER_SEARCH_RESPONSE_INVALID', 502)
  if (citations.size === 0) {
    throw new CodexModelGatewayError('PROVIDER_SEARCH_RESULT_MISSING', 502)
  }
  return { output, results: [...citations.values()] }
}

function validateSearchEndpoint(request: Request): void {
  const url = new URL(request.url)
  if (!url.pathname.endsWith('/api/internal/codex-runtime/model/alpha/search') || url.search || url.hash) {
    throw new CodexModelGatewayError('REQUEST_ENDPOINT_INVALID', 404)
  }
}

/**
 * Codex standalone search adapter for the selected OpenRouter Responses model.
 * The Agent still sees and emits Codex-native `webSearch` items; this module is
 * only the custom provider's authenticated `/alpha/search` wire boundary.
 */
export async function proxyCodexStandaloneSearchRequest(input: {
  readonly request: Request
  readonly scope: {
    readonly userId: string
    readonly projectId: string
    readonly assistantId: string
    readonly nonce: string
  }
}): Promise<Response> {
  validateSearchEndpoint(input.request)
  if (input.scope.assistantId !== CODEX_MODEL_GATEWAY_ASSISTANT_ID) {
    throw new CodexModelGatewayError('SCOPE_INVALID', 403)
  }
  const scope = {
    userId: input.scope.userId,
    projectId: input.scope.projectId,
    assistantId: CODEX_MODEL_GATEWAY_ASSISTANT_ID,
  } as const
  await requireCodexModelGatewayActiveTurn(scope, input.scope.nonce)
  const contentType = input.request.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.startsWith('application/json')) {
    throw new CodexModelGatewayError('REQUEST_BODY_INVALID', 400)
  }
  let parsed: unknown
  try {
    const body = await readRequestBufferWithLimit(
      input.request,
      SEARCH_REQUEST_MAX_BYTES,
      'Codex standalone search request',
    )
    parsed = JSON.parse(body.toString('utf8')) as unknown
  } catch {
    throw new CodexModelGatewayError('REQUEST_BODY_INVALID', 400)
  }
  const request = parseSearchRequest(parsed)
  const upstream = await resolveCodexModelGatewayUpstream(scope)
  if (request.model !== upstream.runtimeModelId) {
    throw new CodexModelGatewayError('REQUEST_MODEL_MISMATCH', 403)
  }

  let response: Response
  try {
    response = await fetchWithProviderProxy(upstream.responsesEndpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${upstream.providerApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildOpenRouterSearchBody(request, upstream.modelId)),
      redirect: 'error',
      signal: input.request.signal,
    })
  } catch {
    input.request.signal.throwIfAborted()
    throw new CodexModelGatewayError('PROVIDER_REQUEST_FAILED', 502)
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new CodexModelGatewayError('PROVIDER_REQUEST_FAILED', 502)
  }
  let upstreamValue: unknown
  try {
    const body = await readResponseBufferWithLimit(
      response,
      SEARCH_RESPONSE_MAX_BYTES,
      'OpenRouter standalone search response',
    )
    upstreamValue = JSON.parse(body.toString('utf8')) as unknown
  } catch {
    throw new CodexModelGatewayError('PROVIDER_SEARCH_RESPONSE_INVALID', 502)
  }
  const projected = projectOpenRouterSearchResponse(upstreamValue)
  return Response.json(
    {
      encrypted_output: null,
      output: projected.output,
      results: projected.results,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
