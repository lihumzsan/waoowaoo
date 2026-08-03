/**
 * Seedance retail prices, in credits per second of output.
 *
 * Seedance is reachable through Ark, FAL and OpenRouter, and what each of them
 * charges us differs. What the user pays must not: the same model at the same
 * resolution is one product with one price, so all three provider catalogs
 * import these rates instead of each deriving their own from their own cost.
 *
 * The rates are set against the most expensive route we actually bill through
 * (OpenRouter, the platform default video provider), so every route clears the
 * margin floor. Ark and FAL simply earn more.
 */
export const SEEDANCE_2_RETAIL_CREDITS_PER_SECOND = {
  standard: { '480p': 9, '720p': 19, '1080p': 44 },
  fast: { '480p': 7, '720p': 15 },
} as const
