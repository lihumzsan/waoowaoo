/**
 * The public shape of a research call.
 *
 * This is the whole surface every caller sees. Deliberately absent: page bodies,
 * raw provider payloads, model reasoning, and any provider-specific knob. What
 * is present is the evidence a caller needs to judge the answer — the report,
 * the queries the provider actually ran, and the sources it actually cited —
 * which is also what makes "did it really search?" a verifiable question rather
 * than a claim.
 */
import { z } from 'zod'

export const WEB_SEARCH_PROVIDER_ID = 'openai' as const

/**
 * A request is one compact research brief. There is no page size, result count,
 * ranking or freshness knob: the hosted search plans its own subqueries, and
 * exposing dials here would only let a model tune something it cannot evaluate.
 */
export const webSearchRequestSchema = z.object({
  query: z.string().trim().min(1).max(1_000)
    .describe('The exact question or compact research brief. Include the subject, medium, language, region, community, and recency only when they matter.'),
  allowedDomains: z.array(z.string().trim().min(1).max(253)).max(20)
    .describe('Domain-only allowlist when research must focus on specific primary sources, forums, or communities. Pass an empty array for open-web research.'),
}).strict()

export const webSearchSourceSchema = z.object({
  title: z.string().trim().min(1).max(500),
  url: z.string().url().max(2_000),
}).strict()

/**
 * Visual evidence returned by the hosted search. Every URL is third-party and
 * untrusted: it must never be rendered or fetched directly, only through the
 * owned media boundary.
 */
export const webSearchImageSchema = z.object({
  imageUrl: z.string().url().max(2_000),
  thumbnailUrl: z.string().url().max(2_000).nullable(),
  sourceUrl: z.string().url().max(2_000).nullable(),
  caption: z.string().trim().min(1).max(1_000).nullable(),
}).strict()

/**
 * `sources` is non-empty by contract. A response with a report but no citation
 * cannot be distinguished from the model answering out of memory, so the
 * provider fails closed instead of returning one. `images` may legitimately be
 * empty — most briefs are textual.
 */
export const webSearchResponseSchema = z.object({
  provider: z.literal(WEB_SEARCH_PROVIDER_ID),
  query: z.string().trim().min(1).max(1_000),
  report: z.string().trim().min(1).max(30_000),
  queries: z.array(z.string().trim().min(1).max(1_000)).max(32),
  sources: z.array(webSearchSourceSchema).min(1).max(32),
  images: z.array(webSearchImageSchema).max(16),
}).strict()

export type WebSearchRequest = z.input<typeof webSearchRequestSchema>
export type NormalizedWebSearchRequest = z.output<typeof webSearchRequestSchema>
export type WebSearchResponse = z.infer<typeof webSearchResponseSchema>
export type WebSearchSource = z.infer<typeof webSearchSourceSchema>
export type WebSearchImage = z.infer<typeof webSearchImageSchema>

/**
 * What the hosted run cost, delivered out of band. It is deliberately not part
 * of `WebSearchResponse`: the model must never see accounting, and the response
 * schema is what the model sees.
 */
export interface WebSearchUsage {
  readonly model: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cachedInputTokens: number
  /** Hosted web_search calls, which OpenAI bills per call on top of tokens. */
  readonly toolCalls: number
}

export type WebSearchUsageListener = (usage: WebSearchUsage) => void
