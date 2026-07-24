import { z } from 'zod'

export const WEB_SEARCH_PROVIDER_ID = 'tavily' as const

export const webSearchRequestSchema = z.object({
  query: z.string().trim().min(1).max(1_000)
    .describe('One focused search query. Use explicit subject, medium, region, and recency terms when they matter.'),
  searchDepth: z.enum(['basic', 'advanced']).optional()
    .describe('basic balances cost and breadth; advanced costs more and returns more targeted snippets.'),
  topic: z.enum(['general', 'news']).optional()
    .describe('Use news only for recent events covered by news sources; use general for styles, communities, references, and broader research.'),
  maxResults: z.number().int().min(1).max(10).optional()
    .describe('Maximum ranked sources to return.'),
  timeRange: z.enum(['day', 'week', 'month', 'year']).optional()
    .describe('Optional publication or update recency filter.'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe('Optional inclusive lower date bound in YYYY-MM-DD format.'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe('Optional upper date bound in YYYY-MM-DD format.'),
  includeDomains: z.array(z.string().trim().min(1).max(253)).max(20).optional()
    .describe('Short allowlist of relevant domains or domain paths, for example reddit.com or zhihu.com.'),
  excludeDomains: z.array(z.string().trim().min(1).max(253)).max(20).optional()
    .describe('Short blocklist of irrelevant domains.'),
}).strict()

export const normalizedWebSearchRequestSchema = webSearchRequestSchema.transform((request) => ({
  ...request,
  searchDepth: request.searchDepth ?? 'basic',
  topic: request.topic ?? 'general',
  maxResults: request.maxResults ?? 5,
  includeDomains: request.includeDomains ?? [],
  excludeDomains: request.excludeDomains ?? [],
}))

export const webSearchSourceSchema = z.object({
  title: z.string().trim().min(1).max(500),
  url: z.string().url().max(2_000),
  content: z.string().max(6_000),
  score: z.number().finite().nullable(),
  publishedAt: z.string().trim().min(1).max(200).nullable(),
}).strict()

export const webSearchResponseSchema = z.object({
  provider: z.literal(WEB_SEARCH_PROVIDER_ID),
  query: z.string().trim().min(1).max(1_000),
  results: z.array(webSearchSourceSchema).max(10),
}).strict()

export type WebSearchRequest = z.input<typeof webSearchRequestSchema>
export type NormalizedWebSearchRequest = z.output<typeof normalizedWebSearchRequestSchema>
export type WebSearchResponse = z.infer<typeof webSearchResponseSchema>
export type WebSearchSource = z.infer<typeof webSearchSourceSchema>
