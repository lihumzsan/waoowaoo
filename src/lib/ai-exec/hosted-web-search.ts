import { createOpenAIWebSearchProvider } from '@/lib/ai-providers/openai/hosted-web-search'
import type {
  NormalizedWebSearchRequest,
  WebSearchResponse,
} from '@/lib/web-search/contracts'

export async function executeOpenAIHostedWebSearch(input: {
  readonly apiKey: string
  readonly request: NormalizedWebSearchRequest
  readonly signal: AbortSignal
}): Promise<WebSearchResponse> {
  const provider = createOpenAIWebSearchProvider({ apiKey: input.apiKey })
  return provider.search(input.request, { signal: input.signal })
}
