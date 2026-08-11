import {
  BUILTIN_API_CONFIG_CATALOG_MODELS,
  BUILTIN_CAPABILITY_CATALOG_ENTRIES,
} from '@/lib/ai-providers/builtin-catalog'
import { registerBuiltinApiConfigCatalog } from '@/lib/ai-registry/api-config-catalog'
import { registerBuiltinCapabilityCatalogEntries } from '@/lib/ai-registry/capabilities-catalog'

let registered = false

export function ensureAiCatalogsRegistered() {
  if (registered) return
  registerBuiltinCapabilityCatalogEntries(BUILTIN_CAPABILITY_CATALOG_ENTRIES)
  registerBuiltinApiConfigCatalog({
    models: BUILTIN_API_CONFIG_CATALOG_MODELS,
  })
  registered = true
}
