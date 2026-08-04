import {
  findBuiltinCapabilityCatalogEntry,
  listBuiltinCapabilityCatalog,
} from '@/lib/ai-registry/capabilities-catalog'
import { composeModelKey, parseModelKeyStrict } from '@/lib/ai-registry/selection'
import type { UnifiedModelType } from '@/lib/ai-registry/types'
import {
  findBuiltinPricingCatalogEntry,
  type PricingApiType,
} from '@/lib/ai-registry/pricing-catalog'

export type AiProviderRoute = {
  readonly provider: string
  readonly modelId: string
  readonly modelKey: string
  readonly priority: number
}

export type AiProviderRouteSet = {
  readonly logicalCapabilityId: string
  readonly primaryModelKey: string
  readonly failoverPolicy: 'pre_accept_only'
  readonly routes: readonly AiProviderRoute[]
}

function canonicalTierWhen(when: Record<string, string | number | boolean>): string {
  return JSON.stringify(Object.entries(when).sort(([left], [right]) => left.localeCompare(right)))
}

function assertFallbackPricingCoversPrimary(input: {
  logicalCapabilityId: string
  apiType: PricingApiType
  primary: AiProviderRoute
  fallback: AiProviderRoute
}): void {
  const primaryEntry = findBuiltinPricingCatalogEntry(
    input.apiType,
    input.primary.provider,
    input.primary.modelId,
  )
  const fallbackEntry = findBuiltinPricingCatalogEntry(
    input.apiType,
    input.fallback.provider,
    input.fallback.modelId,
  )
  if (!primaryEntry || !fallbackEntry) {
    throw new Error(`PROVIDER_ROUTE_PRICING_MISSING:${input.logicalCapabilityId}`)
  }
  // Route equivalence is a promise to the user, not to the accountant: the
  // frozen quote must be identical across routes. Provider cost legitimately
  // differs between routes and is deliberately not compared here.
  const primary = primaryEntry.retail
  const fallback = fallbackEntry.retail
  if (primary.mode !== fallback.mode || primary.unit !== fallback.unit) {
    throw new Error(`PROVIDER_ROUTE_PRICING_CONFLICT:${input.logicalCapabilityId}`)
  }
  if (primary.mode === 'flat') {
    if (primary.flatAmount !== fallback.flatAmount) {
      throw new Error(`PROVIDER_ROUTE_PRICING_CONFLICT:${input.logicalCapabilityId}`)
    }
    return
  }
  const fallbackTiers = new Map((fallback.tiers ?? []).map((tier) => [
    canonicalTierWhen(tier.when),
    tier.amount,
  ]))
  for (const tier of primary.tiers ?? []) {
    if (fallbackTiers.get(canonicalTierWhen(tier.when)) !== tier.amount) {
      throw new Error(`PROVIDER_ROUTE_PRICING_CONFLICT:${input.logicalCapabilityId}`)
    }
  }
}

/**
 * Resolves only registry-declared equivalent provider routes. A model without
 * providerRoute metadata remains a one-route logical capability and can never
 * switch provider.
 */
export function resolveProviderRouteSet(
  modelType: UnifiedModelType,
  selectedModelKey: string,
): AiProviderRouteSet {
  const selected = parseModelKeyStrict(selectedModelKey)
  if (!selected) throw new Error(`MODEL_KEY_INVALID: provider route requires provider::modelId (${selectedModelKey})`)
  const selectedEntry = findBuiltinCapabilityCatalogEntry(modelType, selected.provider, selected.modelId)
  const declaration = selectedEntry?.providerRoute
  if (!declaration) {
    return {
      logicalCapabilityId: `${modelType}:${selected.modelKey}`,
      primaryModelKey: selected.modelKey,
      failoverPolicy: 'pre_accept_only',
      routes: [{
        provider: selected.provider,
        modelId: selected.modelId,
        modelKey: selected.modelKey,
        priority: 0,
      }],
    }
  }

  const members = listBuiltinCapabilityCatalog()
    .filter((entry) => (
      entry.modelType === modelType
      && entry.providerRoute?.logicalCapabilityId === declaration.logicalCapabilityId
    ))
    .map((entry) => {
      const providerRoute = entry.providerRoute
      if (!providerRoute) throw new Error('PROVIDER_ROUTE_DECLARATION_REQUIRED')
      if (providerRoute.failoverPolicy !== declaration.failoverPolicy) {
        throw new Error(`PROVIDER_ROUTE_POLICY_CONFLICT:${declaration.logicalCapabilityId}`)
      }
      return {
        provider: entry.provider,
        modelId: entry.modelId,
        modelKey: composeModelKey(entry.provider, entry.modelId),
        priority: providerRoute.priority,
      }
    })
    .sort((left, right) => left.priority - right.priority || left.modelKey.localeCompare(right.modelKey))

  const priorities = new Set<number>()
  for (const member of members) {
    if (priorities.has(member.priority)) {
      throw new Error(`PROVIDER_ROUTE_PRIORITY_DUPLICATE:${declaration.logicalCapabilityId}:${member.priority}`)
    }
    priorities.add(member.priority)
  }
  const selectedIndex = members.findIndex((member) => member.modelKey === selected.modelKey)
  if (selectedIndex === -1) {
    throw new Error(`PROVIDER_ROUTE_PRIMARY_MISSING:${declaration.logicalCapabilityId}:${selected.modelKey}`)
  }
  if (modelType !== 'image' && modelType !== 'video' && modelType !== 'music') {
    throw new Error(`PROVIDER_ROUTE_MODALITY_UNSUPPORTED:${declaration.logicalCapabilityId}:${modelType}`)
  }
  const primary = members[selectedIndex]
  if (!primary) throw new Error(`PROVIDER_ROUTE_PRIMARY_MISSING:${declaration.logicalCapabilityId}:${selected.modelKey}`)
  for (const fallback of members.slice(selectedIndex + 1)) {
    assertFallbackPricingCoversPrimary({
      logicalCapabilityId: declaration.logicalCapabilityId,
      apiType: modelType,
      primary,
      fallback,
    })
  }

  return {
    logicalCapabilityId: declaration.logicalCapabilityId,
    primaryModelKey: selected.modelKey,
    failoverPolicy: declaration.failoverPolicy,
    routes: members.slice(selectedIndex),
  }
}
