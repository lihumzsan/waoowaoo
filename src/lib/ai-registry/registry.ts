import { getProviderKey } from '@/lib/ai-registry/selection'

export type AiProviderKey = string

export interface AiProviderAdapter {
  readonly providerKey: AiProviderKey
}

export class AiRegistry<TAdapter extends AiProviderAdapter> {
  private readonly adapters: Map<AiProviderKey, TAdapter>

  public constructor(adapters: TAdapter[]) {
    const map = new Map<AiProviderKey, TAdapter>()
    for (const adapter of adapters) {
      if (map.has(adapter.providerKey)) {
        throw new Error(`AI_REGISTRY_PROVIDER_KEY_DUPLICATE:${adapter.providerKey}`)
      }
      map.set(adapter.providerKey, adapter)
    }
    this.adapters = map
  }

  public getAdapterByProviderId(providerId: string): TAdapter {
    const adapter = this.tryGetAdapterByProviderId(providerId)
    if (!adapter) {
      throw new Error(`AI_REGISTRY_PROVIDER_UNSUPPORTED:${getProviderKey(providerId).toLowerCase()}`)
    }
    return adapter
  }

  public tryGetAdapterByProviderId(providerId: string): TAdapter | null {
    const providerKey = getProviderKey(providerId).toLowerCase()
    return this.adapters.get(providerKey) ?? null
  }

  public getAdapters(): readonly TAdapter[] {
    return [...this.adapters.values()]
  }
}
