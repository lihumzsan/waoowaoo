import {
  normalizedWebSearchRequestSchema,
  type WebSearchProgressListener,
  type WebSearchRequest,
  type WebSearchResponse,
} from './contracts'
import { executeOpenAIHostedWebSearch } from '@/lib/ai-exec/hosted-web-search'
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
const DEFAULT_OPENAI_WEB_SEARCH_MODEL = 'gpt-5.6-luna'

export function resolveWebSearchModel(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const configured = environment[OPENAI_WEB_SEARCH_MODEL_ENV]?.trim()
  if (configured === undefined || configured.length === 0) {
    return DEFAULT_OPENAI_WEB_SEARCH_MODEL
  }
  if (configured.includes('::') || configured.includes('/')) {
    throw new WebSearchError('WEB_SEARCH_UNAVAILABLE', {
      provider: 'openai',
      reason: `${OPENAI_WEB_SEARCH_MODEL_ENV} must be a bare OpenAI model id, not a routed model key`,
    })
  }
  return configured
}

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
      onProgress: options.onProgress,
    }),
  }
}

export async function searchWeb(input: {
  readonly request: WebSearchRequest
  readonly signal: AbortSignal
  readonly provider?: WebSearchProvider
  readonly onProgress?: WebSearchProgressListener
}): Promise<WebSearchResponse> {
  const parsed = normalizedWebSearchRequestSchema.safeParse(input.request)
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
    onProgress: input.onProgress,
  })
}
