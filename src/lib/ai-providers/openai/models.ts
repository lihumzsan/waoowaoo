import { usdToCredits } from '@/lib/ai-registry/pricing-currency'

/**
 * OpenAI is registered as a platform-role provider only.
 *
 * The hosted Web Search specialist runs on the platform's own key with a fixed
 * model, so it is deliberately absent from the capability and api-config
 * catalogs: it must never become a user-selectable assistant model. Only
 * pricing is registered, because its usage still settles through the same daily
 * LLM settlement as every other model call, and an unpriced model would make
 * that settlement throw for every user who searched.
 *
 * Rates as published at developers.openai.com/api/docs/pricing, read 2026-08-04.
 * They are provider cost; the retail face is derived from them at the text
 * markup, so this file never states what a user is charged.
 */

/**
 * Platform-level role, not a user selection.
 *
 * `gpt-5-search-api` looks right by name and is cheaper on paper, but OpenAI
 * rejects it on the Responses API, and the hosted web_search tool with its
 * `open_page` actions only exists there. This model is verified to run the tool
 * and report those actions, and is both the newest balanced generation and an
 * order of magnitude cheaper than the 5.4 line it replaces here.
 */
export const OPENAI_WEB_SEARCH_MODEL_ID = 'gpt-5.6-luna'

const INPUT_USD_PER_MILLION_TOKENS = 0.2
const OUTPUT_USD_PER_MILLION_TOKENS = 1.2

/**
 * The hosted web_search tool is billed per call ($10.00 / 1k calls) on top of
 * tokens, and at ~40% of a typical search's total it cannot be folded into the
 * token rate. Every tier in an entry is quoted per million units of whatever
 * that tier selects, so the per-call rate is scaled to the same convention and
 * the cost engine can divide by one million uniformly.
 */
const WEB_SEARCH_CALL_USD_PER_MILLION_CALLS = 10 * 1_000

/**
 * Cached input is not modelled: only Google's context-cache discount is
 * represented in the cost engine, so — as with every other provider here —
 * cached tokens are priced at the full input rate. That overstates our own
 * cost rather than understating it.
 */
export const OPENAI_BUILTIN_PRICING_CATALOG_ENTRIES = [
  {
    apiType: 'text' as const,
    provider: 'openai',
    modelId: OPENAI_WEB_SEARCH_MODEL_ID,
    cost: {
      mode: 'capability' as const,
      tiers: [
        { when: { tokenType: 'input' }, amount: usdToCredits(INPUT_USD_PER_MILLION_TOKENS) },
        { when: { tokenType: 'output' }, amount: usdToCredits(OUTPUT_USD_PER_MILLION_TOKENS) },
        { when: { tokenType: 'toolCall' }, amount: usdToCredits(WEB_SEARCH_CALL_USD_PER_MILLION_CALLS) },
      ],
    },
  },
]

/** OpenAI is not user-selectable; both catalogs stay intentionally empty. */
export const OPENAI_BUILTIN_CAPABILITY_CATALOG_ENTRIES: readonly never[] = []
export const OPENAI_API_CONFIG_CATALOG_MODELS: readonly never[] = []
