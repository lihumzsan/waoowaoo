import type {
  NormalizedWebSearchRequest,
  WebSearchResponse,
} from './contracts'

export interface WebSearchProvider {
  readonly id: 'openai'
  search(
    request: NormalizedWebSearchRequest,
    options: { readonly signal: AbortSignal },
  ): Promise<WebSearchResponse>
}
