import type {
  NormalizedWebSearchRequest,
  WebSearchResponse,
  WebSearchUsageListener,
} from './contracts'

export interface WebSearchProvider {
  readonly id: 'openai'
  search(
    request: NormalizedWebSearchRequest,
    options: {
      readonly signal: AbortSignal
      readonly onUsage?: WebSearchUsageListener
    },
  ): Promise<WebSearchResponse>
}
