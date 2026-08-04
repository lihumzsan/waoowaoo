import { CREDITS_PER_CNY } from '@/lib/billing/credits'
import { minimumEffectiveCreditPriceCny } from '@/lib/billing/subscription-plans'
import type {
  BuiltinPricingCatalogEntry,
  BuiltinPricingDefinition,
  PricingApiType,
} from './pricing-catalog'

/**
 * Retail pricing derivation and the margin guard.
 *
 * Every catalog entry carries two faces: `cost`, the CNY we pay the provider,
 * and `retail`, the credits we charge. A model whose provider file does not
 * declare `retail` gets one derived here from its cost at the api type's
 * markup, so no model can reach billing without a retail price.
 */

/**
 * Retail markup over provider cost, by api type.
 *
 * Stated as a multiple of cost: 1.8 means a credit bought at face value sells
 * the work for 1.8x what the provider charges, which is a 44% gross margin —
 * the two are the same fact with different denominators, and confusing them
 * moves prices by a factor of two.
 *
 * This is the top of the ladder. Every plan discounts below it, so the entry
 * plan lands near +70% and the deepest yearly term near +30%. Raising these
 * does not by itself raise margin: a credit's face value and a plan's grant
 * are the same knob seen from two sides, so a markup change only means
 * something alongside the plan table in `subscription-plans.ts`. What the
 * markup alone does own is the price of buying credits outright, which is why
 * it has to sit above every plan rather than beside them.
 */
export const RETAIL_MARKUP_BY_API_TYPE: Record<PricingApiType, number> = {
  text: 1.75,
  image: 2.0,
  video: 1.8,
  music: 1.8,
  voice: 1.8,
}

/**
 * Api types whose retail rate is quoted per call, per image or per second, and
 * is therefore shown to users as a whole number of credits.
 *
 * Text (per million tokens) and voice (per character) keep fractional rates —
 * a whole credit per token would be absurd. Their rates only become integers
 * once multiplied by a real quantity and rounded by `toChargeableCredits`.
 */
const INTEGER_RETAIL_RATE_API_TYPES: ReadonlySet<PricingApiType> = new Set<PricingApiType>([
  'image',
  'video',
  'music',
])

/**
 * The minimum gross margin any model must hold at the deepest plan discount in
 * the catalog. This is a fuse, not a target: it exists so a price edit or a new
 * plan can never quietly put a model underwater.
 *
 * Set just under the thinnest entry the current catalog produces rather than at
 * a comfortable distance below it — a fuse with slack in it does not trip until
 * the damage is already done.
 */
export const MINIMUM_RETAIL_MARGIN = 0.18

function toRetailAmount(costCny: number, apiType: PricingApiType): number {
  const credits = costCny * RETAIL_MARKUP_BY_API_TYPE[apiType] * CREDITS_PER_CNY
  if (!INTEGER_RETAIL_RATE_API_TYPES.has(apiType)) {
    return Number(credits.toFixed(6))
  }
  return Math.max(1, Math.ceil(Number(credits.toFixed(6))))
}

/** Derive a retail definition from a cost definition, preserving its shape. */
export function retailFromCost(
  cost: BuiltinPricingDefinition,
  apiType: PricingApiType,
): BuiltinPricingDefinition {
  if (cost.mode === 'flat') {
    return {
      mode: 'flat',
      ...(cost.unit ? { unit: cost.unit } : {}),
      flatAmount: toRetailAmount(cost.flatAmount ?? 0, apiType),
    }
  }
  return {
    mode: 'capability',
    ...(cost.unit ? { unit: cost.unit } : {}),
    tiers: (cost.tiers ?? []).map((tier) => ({
      when: { ...tier.when },
      amount: toRetailAmount(tier.amount, apiType),
    })),
  }
}

function listAmounts(definition: BuiltinPricingDefinition): number[] {
  if (definition.mode === 'flat') {
    return typeof definition.flatAmount === 'number' ? [definition.flatAmount] : []
  }
  return (definition.tiers ?? []).map((tier) => tier.amount)
}

export interface PricingMarginViolation {
  readonly apiType: PricingApiType
  readonly provider: string
  readonly modelId: string
  readonly costCny: number
  readonly retailCredits: number
  readonly worstCaseRevenueCny: number
  readonly margin: number
}

/**
 * Pair cost and retail amounts positionally.
 *
 * A derived retail definition always mirrors its cost shape, and a hand-written
 * one is required to declare the same tiers in the same order — the catalog
 * loader rejects any entry where the two shapes disagree, so index alignment is
 * an invariant here rather than an assumption.
 */
function pairAmounts(entry: BuiltinPricingCatalogEntry): Array<{ cost: number; retail: number }> {
  const costs = listAmounts(entry.cost)
  const retails = listAmounts(entry.retail)
  return costs.map((cost, index) => ({ cost, retail: retails[index] ?? 0 }))
}

/**
 * Check every catalog entry stays profitable at the cheapest credit any
 * subscription plan can produce. Returns the violations rather than throwing so
 * the caller can report all of them at once.
 */
export function findPricingMarginViolations(
  entries: readonly BuiltinPricingCatalogEntry[],
  minimumMargin: number = MINIMUM_RETAIL_MARGIN,
): PricingMarginViolation[] {
  const worstCaseCreditPriceCny = minimumEffectiveCreditPriceCny()
  const violations: PricingMarginViolation[] = []

  for (const entry of entries) {
    for (const { cost, retail } of pairAmounts(entry)) {
      if (cost <= 0) continue
      const worstCaseRevenueCny = retail * worstCaseCreditPriceCny
      const margin = (worstCaseRevenueCny - cost) / worstCaseRevenueCny
      if (worstCaseRevenueCny <= 0 || margin < minimumMargin) {
        violations.push({
          apiType: entry.apiType,
          provider: entry.provider,
          modelId: entry.modelId,
          costCny: cost,
          retailCredits: retail,
          worstCaseRevenueCny: Number(worstCaseRevenueCny.toFixed(6)),
          margin: Number(margin.toFixed(4)),
        })
      }
    }
  }

  return violations
}

export function describePricingMarginViolation(violation: PricingMarginViolation): string {
  const marginPercent = (violation.margin * 100).toFixed(1)
  return `${violation.apiType} ${violation.provider}::${violation.modelId}`
    + ` cost=¥${violation.costCny} retail=${violation.retailCredits}cr`
    + ` worstCaseRevenue=¥${violation.worstCaseRevenueCny} margin=${marginPercent}%`
}
