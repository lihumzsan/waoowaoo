import type {
  NormalizedWebSearchRequest,
  WebSearchProgressListener,
  WebSearchResponse,
} from './contracts'

export interface WebSearchProvider {
  readonly id: 'openai'
  search(
    request: NormalizedWebSearchRequest,
    options: {
      readonly signal: AbortSignal
      readonly onProgress?: WebSearchProgressListener
    },
  ): Promise<WebSearchResponse>
}
