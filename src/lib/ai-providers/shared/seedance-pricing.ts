/**
 * Seedance retail prices, in credits per second of output.
 *
 * Seedance is reachable through Ark, FAL, OpenRouter and Toonflow, and what each of them
 * charges us differs. What the user pays must not: the same model at the same
 * resolution is one product with one price, so every registered provider
 * catalog imports these rates instead of deriving retail from its own cost.
 *
 * The rates are set against the most expensive route we actually bill through,
 * so every registered route clears the margin floor.
 */
export const SEEDANCE_2_RETAIL_CREDITS_PER_SECOND = {
  standard: { '480p': 20, '720p': 43, '1080p': 98 },
  fast: { '480p': 16, '720p': 34 },
} as const
