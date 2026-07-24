import {
  normalizedWebSearchRequestSchema,
  type WebSearchRequest,
  type WebSearchResponse,
} from './contracts'
import { WebSearchError } from './errors'
import type { WebSearchProvider } from './provider'
import { createTavilyWebSearchProvider } from './tavily'

export function createConfiguredWebSearchProvider(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): WebSearchProvider {
  const apiKey = environment.TAVILY_API_KEY?.trim() ?? ''
  if (!apiKey) {
    throw new WebSearchError('WEB_SEARCH_UNAVAILABLE', {
      provider: 'tavily',
      reason: 'TAVILY_API_KEY is not configured',
    })
  }
  return createTavilyWebSearchProvider({ apiKey })
}

export async function searchWeb(input: {
  readonly request: WebSearchRequest
  readonly signal: AbortSignal
  readonly provider?: WebSearchProvider
}): Promise<WebSearchResponse> {
  const parsed = normalizedWebSearchRequestSchema.safeParse(input.request)
  if (!parsed.success) {
    throw new WebSearchError('WEB_SEARCH_REQUEST_FAILED', {
      provider: input.provider?.id ?? 'tavily',
      reason: 'request contract mismatch',
      issueCount: parsed.error.issues.length,
    })
  }
  const provider = input.provider ?? createConfiguredWebSearchProvider()
  return provider.search(parsed.data, { signal: input.signal })
}
