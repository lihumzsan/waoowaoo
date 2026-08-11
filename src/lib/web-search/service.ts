/**
 * The single business entry point for web search.
 *
 * Every caller — the Primary Operation and the Creative Direction Worker tool —
 * goes through `searchWeb`. Neither constructs an OpenAI client, an agent, or a
 * hosted tool of its own, which is what keeps one provider decision, one
 * credential read and one failure vocabulary for the whole product.
 */
import {
  webSearchRequestSchema,
  type WebSearchRequest,
  type WebSearchResponse,
  type WebSearchUsageListener,
} from './contracts'
import { executeOpenAIHostedWebSearch } from '@/lib/ai-exec/hosted-web-search'
import { OPENAI_WEB_SEARCH_MODEL_ID } from '@/lib/ai-providers/openai/models'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { findBuiltinPricingCatalogEntry } from '@/lib/ai-registry/pricing-catalog'
import { WebSearchError } from './errors'
import type { WebSearchProvider } from './provider'

/**
 * The hosted `web_search` tool only exists inside OpenAI's own Responses
 * execution boundary, so this model role is deliberately not part of the
 * user-selectable model registry: every configured LLM there is routed through
 * OpenRouter/Ark/Fal/Google and could not run the tool. It is a platform-level
 * OpenAI model id, overridable per deployment and validated on read.
 */
export const OPENAI_WEB_SEARCH_MODEL_ENV = 'OPENAI_WEB_SEARCH_MODEL'

export function resolveWebSearchModel(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  ensureAiCatalogsRegistered()
  const configured = environment[OPENAI_WEB_SEARCH_MODEL_ENV]?.trim()
  if (configured === undefined || configured.length === 0) {
    return OPENAI_WEB_SEARCH_MODEL_ID
  }
  if (configured.includes('::') || configured.includes('/')) {
    throw new WebSearchError('WEB_SEARCH_UNAVAILABLE', {
      provider: 'openai',
      reason: `${OPENAI_WEB_SEARCH_MODEL_ENV} must be a bare OpenAI model id, not a routed model key`,
    })
  }
  // Usage settles from the pricing catalog after the response, so an unpriced
  // override would fail only after the Provider has already been paid. Refuse
  // it while the request is still free.
  if (!findBuiltinPricingCatalogEntry('text', 'openai', configured)) {
    throw new WebSearchError('WEB_SEARCH_UNAVAILABLE', {
      provider: 'openai',
      reason: `${OPENAI_WEB_SEARCH_MODEL_ENV}=${configured} has no registered price`,
    })
  }
  return configured
}

/**
 * Reads the only supported configuration. A missing key fails here with a typed
 * error rather than degrading to a keyless call or borrowing the Primary /
 * analysis provider's credentials — an unconfigured deployment must be obvious,
 * not quietly worse at research.
 */
export function createConfiguredWebSearchProvider(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): WebSearchProvider {
  const apiKey = environment.OPENAI_API_KEY?.trim() ?? ''
  if (!apiKey) {
    throw new WebSearchError('WEB_SEARCH_UNAVAILABLE', {
      provider: 'openai',
      reason: 'OPENAI_API_KEY is not configured',
    })
  }
  const model = resolveWebSearchModel(environment)
  return {
    id: 'openai',
    search: (request, options) => executeOpenAIHostedWebSearch({
      apiKey,
      model,
      request,
      signal: options.signal,
      onUsage: options.onUsage,
    }),
  }
}

/**
 * Validates the request against the public contract before any network call, so
 * a malformed model-authored brief is a typed request failure instead of a
 * wasted paid round trip. Production callers either resolve the configured
 * provider here or inject the result of `createConfiguredWebSearchProvider`
 * when they need to claim a durable provider attempt before the network call.
 */
export async function searchWeb(input: {
  readonly request: WebSearchRequest
  readonly signal: AbortSignal
  readonly provider?: WebSearchProvider
  readonly onUsage?: WebSearchUsageListener
}): Promise<WebSearchResponse> {
  const parsed = webSearchRequestSchema.safeParse(input.request)
  if (!parsed.success) {
    throw new WebSearchError('WEB_SEARCH_REQUEST_FAILED', {
      provider: input.provider?.id ?? 'openai',
      reason: 'request contract mismatch',
      issueCount: parsed.error.issues.length,
    })
  }
  const provider = input.provider ?? createConfiguredWebSearchProvider()
  return provider.search(parsed.data, {
    signal: input.signal,
    onUsage: input.onUsage,
  })
}
