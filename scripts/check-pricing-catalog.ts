/**
 * Verify the production pricing catalog.
 *
 * Prices used to be declared twice — once in the provider TypeScript catalogs
 * that actually bill, and once in a `standards/pricing` JSON mirror that only
 * this script read. The mirror drifted (52 entries against 70 live ones) while
 * still reporting OK, so "the check passed" said nothing about what users were
 * charged. The mirror is gone; this script now loads the same catalog the
 * billing path loads.
 *
 * Registration itself enforces the hard rules — every selectable model has a
 * price, cost and retail shapes agree, and no price is underwater at the
 * deepest plan discount — so loading the catalog is the check. What this script
 * adds is the report: what we charge, what it costs us, and where margin is
 * thinnest.
 */
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { listBuiltinPricingCatalog, type BuiltinPricingDefinition } from '@/lib/ai-registry/pricing-catalog'
import { MINIMUM_RETAIL_MARGIN } from '@/lib/ai-registry/pricing-retail'
import { minimumEffectiveCreditPriceCny } from '@/lib/billing/subscription-plans'

const THINNEST_MARGIN_ROWS = 12

function listAmounts(definition: BuiltinPricingDefinition): number[] {
  if (definition.mode === 'flat') {
    return typeof definition.flatAmount === 'number' ? [definition.flatAmount] : []
  }
  return (definition.tiers ?? []).map((tier) => tier.amount)
}

function main(): void {
  ensureAiCatalogsRegistered()

  const entries = listBuiltinPricingCatalog()
  const worstCaseCreditPriceCny = minimumEffectiveCreditPriceCny()

  const rows: Array<{ label: string; cost: number; retail: number; margin: number }> = []
  for (const entry of entries) {
    const costs = listAmounts(entry.cost)
    const retails = listAmounts(entry.retail)
    costs.forEach((cost, index) => {
      if (cost <= 0) return
      const retail = retails[index] ?? 0
      const revenue = retail * worstCaseCreditPriceCny
      rows.push({
        label: `${entry.apiType}/${entry.provider}::${entry.modelId}`,
        cost,
        retail,
        margin: revenue > 0 ? (revenue - cost) / revenue : -1,
      })
    })
  }

  rows.sort((left, right) => left.margin - right.margin)

  process.stdout.write(`[check-pricing-catalog] ${entries.length} models, ${rows.length} priced amounts\n`)
  process.stdout.write(
    `[check-pricing-catalog] worst-case ¥${worstCaseCreditPriceCny.toFixed(5)} per credit`
    + ` (floor ${(MINIMUM_RETAIL_MARGIN * 100).toFixed(0)}% margin)\n`,
  )
  process.stdout.write(`[check-pricing-catalog] thinnest margins:\n`)
  for (const row of rows.slice(0, THINNEST_MARGIN_ROWS)) {
    process.stdout.write(
      `  ${(row.margin * 100).toFixed(1).padStart(6)}%  cost=¥${row.cost}  retail=${row.retail}cr  ${row.label}\n`,
    )
  }
  process.stdout.write('[check-pricing-catalog] OK\n')
}

try {
  main()
} catch (error) {
  process.stderr.write(`[check-pricing-catalog] failed: ${String(error)}\n`)
  process.exitCode = 1
}
