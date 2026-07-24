import { z } from 'zod'
import {
  WEB_SEARCH_PROVIDER_ID,
  webSearchResponseSchema,
  type NormalizedWebSearchRequest,
  type WebSearchSource,
} from './contracts'
import { WebSearchError } from './errors'
import type { WebSearchProvider } from './provider'
import { fetchWithProviderProxy } from '@/lib/http/outbound-proxy'

const TAVILY_SEARCH_ENDPOINT = 'https://api.tavily.com/search'
const TAVILY_REQUEST_TIMEOUT_MS = 20_000

const tavilyResultSchema = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
  content: z.string().optional(),
  score: z.number().optional(),
  published_date: z.string().nullable().optional(),
}).passthrough()

const tavilyResponseSchema = z.object({
  query: z.string().optional(),
  results: z.array(tavilyResultSchema).optional(),
}).passthrough()

type FetchImplementation = typeof fetch

function normalizeString(value: string | undefined, maxLength: number): string {
  return (value ?? '').trim().slice(0, maxLength)
}

function normalizeHttpUrl(value: string | undefined): string | null {
  const normalized = normalizeString(value, 2_000)
  if (!normalized) return null
  try {
    const parsed = new URL(normalized)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.toString()
      : null
  } catch {
    return null
  }
}

function normalizeSource(
  value: z.infer<typeof tavilyResultSchema>,
): WebSearchSource | null {
  const title = normalizeString(value.title, 500)
  const url = normalizeHttpUrl(value.url)
  if (!title || !url) return null
  return {
    title,
    url,
    content: normalizeString(value.content, 6_000),
    score: typeof value.score === 'number' && Number.isFinite(value.score)
      ? value.score
      : null,
    publishedAt: normalizeString(value.published_date ?? undefined, 200) || null,
  }
}

function statusError(response: Response): WebSearchError {
  if (response.status === 401 || response.status === 403) {
    return new WebSearchError('WEB_SEARCH_UNAVAILABLE', {
      provider: WEB_SEARCH_PROVIDER_ID,
      status: response.status,
      reason: 'provider rejected configured credentials',
    })
  }
  return new WebSearchError('WEB_SEARCH_REQUEST_FAILED', {
    provider: WEB_SEARCH_PROVIDER_ID,
    status: response.status,
  }, {
    retryable: response.status === 429 || response.status >= 500,
  })
}

export function createTavilyWebSearchProvider(input: {
  readonly apiKey: string
  readonly fetchImpl?: FetchImplementation
}): WebSearchProvider {
  const apiKey = input.apiKey.trim()
  if (!apiKey) {
    throw new WebSearchError('WEB_SEARCH_UNAVAILABLE', {
      provider: WEB_SEARCH_PROVIDER_ID,
      reason: 'TAVILY_API_KEY is not configured',
    })
  }
  const fetchImpl = input.fetchImpl ?? fetchWithProviderProxy
  return {
    id: WEB_SEARCH_PROVIDER_ID,
    search: async (request: NormalizedWebSearchRequest, options) => {
      const timeoutSignal = AbortSignal.timeout(TAVILY_REQUEST_TIMEOUT_MS)
      const signal = AbortSignal.any([options.signal, timeoutSignal])
      let response: Response
      try {
        response = await fetchImpl(TAVILY_SEARCH_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            query: request.query,
            search_depth: request.searchDepth,
            chunks_per_source: request.searchDepth === 'advanced' ? 3 : undefined,
            max_results: request.maxResults,
            topic: request.topic,
            time_range: request.timeRange,
            start_date: request.startDate,
            end_date: request.endDate,
            include_domains: request.includeDomains,
            exclude_domains: request.excludeDomains,
            include_answer: false,
            include_raw_content: false,
            include_images: false,
            auto_parameters: false,
          }),
          cache: 'no-store',
          signal,
        })
      } catch (error) {
        if (options.signal.aborted) {
          throw new WebSearchError('WEB_SEARCH_ABORTED', {
            provider: WEB_SEARCH_PROVIDER_ID,
          }, { cause: error })
        }
        throw new WebSearchError('WEB_SEARCH_REQUEST_FAILED', {
          provider: WEB_SEARCH_PROVIDER_ID,
          reason: timeoutSignal.aborted ? 'request timed out' : 'network request failed',
        }, { cause: error, retryable: true })
      }
      if (!response.ok) throw statusError(response)

      let raw: unknown
      try {
        raw = await response.json() as unknown
      } catch (error) {
        throw new WebSearchError('WEB_SEARCH_RESPONSE_INVALID', {
          provider: WEB_SEARCH_PROVIDER_ID,
          reason: 'response is not valid JSON',
        }, { cause: error })
      }
      const parsed = tavilyResponseSchema.safeParse(raw)
      if (!parsed.success || !parsed.data.results) {
        throw new WebSearchError('WEB_SEARCH_RESPONSE_INVALID', {
          provider: WEB_SEARCH_PROVIDER_ID,
          reason: 'response contract mismatch',
        }, { cause: parsed.success ? undefined : parsed.error })
      }
      const results = parsed.data.results
        .map(normalizeSource)
        .filter((source): source is WebSearchSource => source !== null)
        .slice(0, request.maxResults)
      return webSearchResponseSchema.parse({
        provider: WEB_SEARCH_PROVIDER_ID,
        query: request.query,
        results,
      })
    },
  }
}
