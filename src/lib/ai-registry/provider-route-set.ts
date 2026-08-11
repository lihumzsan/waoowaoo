import {
  findBuiltinCapabilityCatalogEntry,
  listBuiltinCapabilityCatalog,
} from '@/lib/ai-registry/capabilities-catalog'
import { composeModelKey, parseModelKeyStrict } from '@/lib/ai-registry/selection'
import type { UnifiedModelType } from '@/lib/ai-registry/types'

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
  if (modelType !== 'image' && modelType !== 'video' && modelType !== 'music' && modelType !== 'sound') {
    throw new Error(`PROVIDER_ROUTE_MODALITY_UNSUPPORTED:${declaration.logicalCapabilityId}:${modelType}`)
  }
  const primary = members[selectedIndex]
  if (!primary) throw new Error(`PROVIDER_ROUTE_PRIMARY_MISSING:${declaration.logicalCapabilityId}:${selected.modelKey}`)
  return {
    logicalCapabilityId: declaration.logicalCapabilityId,
    primaryModelKey: selected.modelKey,
    failoverPolicy: declaration.failoverPolicy,
    routes: members.slice(selectedIndex),
  }
}
