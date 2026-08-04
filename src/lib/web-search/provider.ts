import type {
  NormalizedWebSearchRequest,
  WebSearchProgressListener,
  WebSearchResponse,
  WebSearchUsageListener,
} from './contracts'

export interface WebSearchProvider {
  readonly id: 'openai'
  search(
    request: NormalizedWebSearchRequest,
    options: {
      readonly signal: AbortSignal
      readonly onProgress?: WebSearchProgressListener
      readonly onUsage?: WebSearchUsageListener
    },
  ): Promise<WebSearchResponse>
}
