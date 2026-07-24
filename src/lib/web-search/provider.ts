import type {
  NormalizedWebSearchRequest,
  WebSearchResponse,
} from './contracts'

export interface WebSearchProvider {
  readonly id: 'tavily'
  search(
    request: NormalizedWebSearchRequest,
    options: { readonly signal: AbortSignal },
  ): Promise<WebSearchResponse>
}
