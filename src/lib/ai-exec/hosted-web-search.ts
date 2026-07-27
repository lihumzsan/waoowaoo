import { createOpenAIWebSearchProvider } from '@/lib/ai-providers/openai/hosted-web-search'
import type {
  NormalizedWebSearchRequest,
  WebSearchProgressListener,
  WebSearchResponse,
} from '@/lib/web-search/contracts'

export async function executeOpenAIHostedWebSearch(input: {
  readonly apiKey: string
  readonly model: string
  readonly request: NormalizedWebSearchRequest
  readonly signal: AbortSignal
  readonly onProgress?: WebSearchProgressListener
}): Promise<WebSearchResponse> {
  const provider = createOpenAIWebSearchProvider({
    apiKey: input.apiKey,
    model: input.model,
  })
  return provider.search(input.request, {
    signal: input.signal,
    onProgress: input.onProgress,
  })
}
