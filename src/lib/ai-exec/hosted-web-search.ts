/**
 * The execution boundary for hosted research.
 *
 * `ai-exec` is where the product crosses into a model provider, so the OpenAI
 * client is constructed here and nowhere else. Keeping this hop — rather than
 * letting the service import the provider directly — is what stops a future
 * caller from reaching for its own client when it wants one more knob.
 */
import { createOpenAIWebSearchProvider } from '@/lib/ai-providers/openai/hosted-web-search'
import { runRegisteredProviderOperation } from '@/lib/ai-providers'
import type {
  NormalizedWebSearchRequest,
  WebSearchResponse,
  WebSearchUsageListener,
} from '@/lib/web-search/contracts'

export async function executeOpenAIHostedWebSearch(input: {
  readonly apiKey: string
  readonly model: string
  readonly request: NormalizedWebSearchRequest
  readonly signal: AbortSignal
  readonly onUsage?: WebSearchUsageListener
}): Promise<WebSearchResponse> {
  const provider = createOpenAIWebSearchProvider({
    apiKey: input.apiKey,
    model: input.model,
  })
  return await runRegisteredProviderOperation({
    providerId: 'openai',
    phase: 'search',
    run: async () => await provider.search(input.request, {
      signal: input.signal,
      onUsage: input.onUsage,
    }),
  })
}
