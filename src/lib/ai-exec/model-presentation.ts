import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { listApiConfigCatalogModels } from '@/lib/ai-registry/api-config-catalog'
import {
  composeModelKey,
  getProviderKey,
  parseModelKeyStrict,
} from '@/lib/ai-registry/selection'

ensureAiCatalogsRegistered()

const PUBLIC_MODEL_NAME_BY_KEY = new Map(
  listApiConfigCatalogModels().map((model) => [
    composeModelKey(model.provider, model.modelId),
    model.name,
  ]),
)

/**
 * Projects an internal provider-qualified model identity into a public model
 * label. Routing identities stay in persistence; user-facing Views never
 * receive the provider portion of `provider::modelId`.
 */
export function resolvePublicModelName(
  modelKey: string | null | undefined,
): string | null {
  const value = modelKey?.trim()
  if (!value) return null

  const parsed = parseModelKeyStrict(value)
  if (!parsed) return value

  const exactName = PUBLIC_MODEL_NAME_BY_KEY.get(parsed.modelKey)
  if (exactName) return exactName

  const providerKey = getProviderKey(parsed.provider).toLowerCase()
  const builtinName = PUBLIC_MODEL_NAME_BY_KEY.get(
    composeModelKey(providerKey, parsed.modelId),
  )
  return builtinName ?? parsed.modelId
}
