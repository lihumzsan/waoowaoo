import { readRequestBufferWithLimit } from '@/lib/http/body-limits'
import { createScopedLogger } from '@/lib/logging/core'
import {
  buildLlmUsageFactId,
  recordLlmUsageFact,
  type LlmUsageFact,
} from '@/lib/billing/llm-usage'
import { prisma } from '@/lib/prisma'
import { isWebSearchError, searchWeb, type WebSearchUsage } from '@/lib/web-search'
import {
  CODEX_MODEL_GATEWAY_ASSISTANT_ID,
  CodexModelGatewayError,
} from './contracts'
import { requireCodexModelGatewayActiveTurn } from './active-turn-guard'

/**
 * Codex's standalone web search boundary.
 *
 * Codex owns the search tool the model sees, which is why this endpoint exists:
 * a custom provider must answer the search itself. That ownership is also what
 * makes the search legible — Codex creates one `webSearch` item per call, with
 * the model's own query on it, so a run of three searches renders as three
 * rows without any progress channel. MCP progress cannot do that today, because
 * Codex drops those notifications on receipt (openai/codex#28003).
 *
 * The search itself is delegated to the OpenAI hosted research specialist
 * through the single `searchWeb` entry, so the assistant's own model stays free
 * to be any OpenRouter model while research quality does not depend on that
 * choice.
 */

const SEARCH_REQUEST_MAX_BYTES = 4 * 1024 * 1024
const MAX_SEARCH_QUERIES = 4
const MAX_ALLOWED_DOMAINS = 20

const searchLogger = createScopedLogger({ module: 'codex-gateway.search' })

type SearchQuery = {
  readonly q: string
  readonly domains: readonly string[]
}

type SearchRequest = {
  readonly queries: readonly SearchQuery[]
  readonly allowedDomains: readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assertOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): void {
  const keys = new Set(allowed)
  if (Object.keys(record).some((key) => !keys.has(key))) {
    throw new CodexModelGatewayError('SEARCH_COMMAND_UNSUPPORTED', 422)
  }
}

function requireString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new CodexModelGatewayError('SEARCH_QUERY_INVALID', 422)
  }
  return value.trim()
}

function readStringArray(value: unknown): readonly string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > MAX_ALLOWED_DOMAINS) {
    throw new CodexModelGatewayError('SEARCH_QUERY_INVALID', 422)
  }
  return value.map((item) => requireString(item))
}

function readQueries(value: unknown): readonly SearchQuery[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_SEARCH_QUERIES) {
    throw new CodexModelGatewayError('SEARCH_QUERY_INVALID', 422)
  }
  return value.map((entry) => {
    if (!isRecord(entry)) throw new CodexModelGatewayError('SEARCH_QUERY_INVALID', 422)
    return { q: requireString(entry.q), domains: readStringArray(entry.domains) }
  })
}

/**
 * Only the commands the hosted specialist can honour are accepted. Anything
 * else fails explicitly rather than being silently dropped, so the model learns
 * the real capability instead of receiving a quietly narrower answer.
 */
function parseSearchRequest(value: unknown): SearchRequest {
  if (!isRecord(value)) throw new CodexModelGatewayError('SEARCH_QUERY_INVALID', 422)
  if (!isRecord(value.commands)) throw new CodexModelGatewayError('SEARCH_QUERY_INVALID', 422)
  assertOnlyKeys(value.commands, ['search_query', 'image_query', 'response_length'])
  const queries = [
    ...(value.commands.search_query === undefined ? [] : readQueries(value.commands.search_query)),
    ...(value.commands.image_query === undefined ? [] : readQueries(value.commands.image_query)),
  ]
  if (queries.length < 1 || queries.length > MAX_SEARCH_QUERIES) {
    throw new CodexModelGatewayError('SEARCH_QUERY_INVALID', 422)
  }
  const settings = isRecord(value.settings) ? value.settings : {}
  const filters = isRecord(settings.filters) ? settings.filters : {}
  if (Array.isArray(filters.blocked_domains) && filters.blocked_domains.length > 0) {
    throw new CodexModelGatewayError('SEARCH_COMMAND_UNSUPPORTED', 422)
  }
  return {
    queries,
    allowedDomains: readStringArray(filters.allowed_domains),
  }
}

/**
 * Codex may batch several queries into one call. The hosted specialist plans
 * its own sub-queries from a brief, so they are handed over as one brief rather
 * than fanned out into several paid runs.
 */
function buildBrief(request: SearchRequest): string {
  if (request.queries.length === 1) return request.queries[0].q
  return request.queries.map((query, index) => `${String(index + 1)}. ${query.q}`).join('\n')
}

function validateSearchEndpoint(request: Request): void {
  const url = new URL(request.url)
  if (!url.pathname.endsWith('/api/internal/codex-runtime/model/alpha/search') || url.search || url.hash) {
    throw new CodexModelGatewayError('REQUEST_ENDPOINT_INVALID', 404)
  }
}

/**
 * Records one search's cost. The research already ran and the model is owed its
 * result, so a ledger fault is a loud audit alert rather than a failed search.
 */
async function recordSearchUsage(input: {
  readonly usage: WebSearchUsage | null
  readonly userId: string
  readonly projectId: string
  readonly turnId: string
  readonly requestId: string
}): Promise<void> {
  if (!input.usage) return
  const fact: LlmUsageFact = {
    phase: 'web_search',
    modelKey: input.usage.model,
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    cachedInputTokens: input.usage.cachedInputTokens,
    requestCount: 1,
    toolCalls: input.usage.toolCalls,
  }
  try {
    await prisma.$transaction(async (tx) => {
      await recordLlmUsageFact(tx, {
        // Identity is this search, not the Turn: a Turn may research several
        // times and a Turn-scoped id would drop every cost after the first.
        usageId: buildLlmUsageFactId('web-search', [input.turnId, input.requestId]),
        projectId: input.projectId,
        userId: input.userId,
        action: 'assistant.web_search',
        usage: fact,
        metadata: { turnId: input.turnId, requestId: input.requestId },
      })
    })
  } catch (error) {
    searchLogger.error({
      audit: true,
      action: 'alert.billing.web_search_usage_unrecorded',
      message: 'web search usage could not be recorded; the provider call is unbilled',
      userId: input.userId,
      projectId: input.projectId,
      details: { turnId: input.turnId, model: input.usage.model, toolCalls: input.usage.toolCalls },
      error,
    })
  }
}

/**
 * Projects the research result into the shape Codex expects. Citations keep
 * their own identity so the product View can render real sources; images are
 * public source previews and never workspace media.
 */
function projectSearchResponse(input: {
  readonly report: string
  readonly sources: readonly { readonly title: string; readonly url: string }[]
  readonly images: readonly { readonly imageUrl: string; readonly sourceUrl: string | null; readonly caption: string | null }[]
}): { readonly output: string; readonly results: readonly Record<string, unknown>[] } {
  const domainOf = (url: string): string | null => {
    try {
      return new URL(url).hostname.replace(/^www\./, '')
    } catch {
      return null
    }
  }
  const results: Record<string, unknown>[] = input.sources.map((source, index) => ({
    type: 'text_result',
    ref_id: `turn0search${String(index)}`,
    url: source.url,
    title: source.title,
    source_domain: domainOf(source.url),
  }))
  input.images.forEach((image, index) => {
    if (!image.sourceUrl) return
    results.push({
      type: 'image_result',
      ref_id: `turn0image${String(index)}`,
      image_url: image.imageUrl,
      source_url: image.sourceUrl,
      source_domain: domainOf(image.sourceUrl),
      ...(image.caption ? { title: image.caption } : {}),
    })
  })
  return { output: input.report, results }
}

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
  const activeTurn = await requireCodexModelGatewayActiveTurn(scope, input.scope.nonce)
  const contentType = input.request.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.startsWith('application/json')) {
    throw new CodexModelGatewayError('REQUEST_BODY_INVALID', 400)
  }
  const body = await readRequestBufferWithLimit(input.request, SEARCH_REQUEST_MAX_BYTES, 'codex_standalone_search_request')
  let parsed: unknown
  try {
    parsed = JSON.parse(body.toString('utf8'))
  } catch {
    throw new CodexModelGatewayError('REQUEST_BODY_INVALID', 400)
  }
  const searchRequest = parseSearchRequest(parsed)
  const requestId = isRecord(parsed) && typeof parsed.id === 'string' && parsed.id.trim()
    ? parsed.id.trim()
    : buildBrief(searchRequest).slice(0, 191)

  let usage: WebSearchUsage | null = null
  try {
    const response = await searchWeb({
      request: { query: buildBrief(searchRequest), allowedDomains: [...searchRequest.allowedDomains] },
      signal: input.request.signal,
      onUsage: (value) => { usage = value },
    })
    await recordSearchUsage({ usage, userId: scope.userId, projectId: scope.projectId, turnId: activeTurn.turnId, requestId })
    return Response.json(projectSearchResponse({
      report: response.report,
      sources: response.sources,
      images: response.images,
    }))
  } catch (error) {
    await recordSearchUsage({ usage, userId: scope.userId, projectId: scope.projectId, turnId: activeTurn.turnId, requestId })
    if (isWebSearchError(error)) {
      // A missing credential is a configuration fault the operator must see;
      // everything else is the provider's own failure surfaced verbatim.
      throw new CodexModelGatewayError(
        error.code === 'WEB_SEARCH_UNAVAILABLE' ? 'PROVIDER_CONFIG_UNAVAILABLE' : 'PROVIDER_SEARCH_RESPONSE_INVALID',
        error.code === 'WEB_SEARCH_UNAVAILABLE' ? 503 : 502,
      )
    }
    throw error
  }
}
