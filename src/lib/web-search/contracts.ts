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
 * Live hosted-search progress, mirroring the action vocabulary the hosted model
 * reports as it works: it plans queries, opens pages, and searches within them.
 * Surfacing the action is what makes a variable-length research run legible —
 * the same run can be one four-second lookup or three rounds of reading.
 *
 * It is presentation only: no caller may derive a completion, failure, or
 * evidence decision from it. Progress can be dropped, delayed or replayed
 * without changing a single recorded fact.
 */
export interface WebSearchProgressEvent {
  readonly phase: 'started' | 'completed'
  /**
   * Null while a step is still running: OpenAI only populates the action once
   * the step finishes, so claiming "opening zhihu.com" mid-flight would be a
   * guess. A running step is reported as exactly what is known — that one is
   * in flight — and names itself when it completes.
   */
  readonly action: 'search' | 'open_page' | 'find_in_page' | null
  /** Present for a completed `search`; the query the hosted model actually ran. */
  readonly query: string | null
  /** Present for a completed `open_page` / `find_in_page`; the page it read. */
  readonly url: string | null
}

export type WebSearchProgressListener = (event: WebSearchProgressEvent) => void
