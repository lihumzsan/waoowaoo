import {
  BUILTIN_API_CONFIG_CATALOG_MODELS,
  BUILTIN_CAPABILITY_CATALOG_ENTRIES,
  BUILTIN_PRICING_CATALOG_ENTRIES,
} from '@/lib/ai-providers/builtin-catalog'
import { registerBuiltinApiConfigCatalog } from '@/lib/ai-registry/api-config-catalog'
import { registerBuiltinCapabilityCatalogEntries } from '@/lib/ai-registry/capabilities-catalog'
import { registerBuiltinPricingCatalogEntries } from '@/lib/ai-registry/pricing-catalog'
import { assertEverySelectableModelIsPriced } from '@/lib/ai-registry/pricing-coverage'

let registered = false

export function ensureAiCatalogsRegistered() {
  if (registered) return
  registerBuiltinCapabilityCatalogEntries(BUILTIN_CAPABILITY_CATALOG_ENTRIES)
  registerBuiltinPricingCatalogEntries(BUILTIN_PRICING_CATALOG_ENTRIES)
  registerBuiltinApiConfigCatalog({
    models: BUILTIN_API_CONFIG_CATALOG_MODELS,
  })
  // Runs after all three catalogs are registered: a model offered by one of
  // them but priced by none of them must fail here, not at billing time.
  assertEverySelectableModelIsPriced()
  registered = true
}
