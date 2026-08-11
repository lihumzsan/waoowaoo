'use client'

import { useMemo } from 'react'
import type { CustomModel, Provider } from '../../api-config'
import { getProviderKey } from '../../api-config'

interface UseApiConfigFiltersParams {
  providers: Provider[]
  models: CustomModel[]
}

interface EnabledModelOption extends CustomModel {
  providerName: string
}

const ALWAYS_SHOW_PROVIDERS: string[] = []
const ALLOWED_PROVIDER_KEYS = new Set(['ark', 'openrouter', 'fal', 'google', 'comfyui'])
const PROVIDER_MODEL_TYPES: Array<'llm' | 'image' | 'video' | 'music' | 'sound'> = ['llm', 'image', 'video', 'music', 'sound']
const MODEL_PROVIDER_KEYS = [
  'ark',
  'google',
  'openrouter',
  'fal',
  'comfyui',
]

function isProviderModelType(type: CustomModel['type']): type is 'llm' | 'image' | 'video' | 'music' | 'sound' {
  return PROVIDER_MODEL_TYPES.includes(type as 'llm' | 'image' | 'video' | 'music' | 'sound')
}

function isDefaultModelType(type: CustomModel['type']): type is 'llm' | 'image' | 'video' | 'music' | 'sound' {
  return type === 'llm' || type === 'image' || type === 'video' || type === 'music' || type === 'sound'
}

function hasProviderApiKey(provider: Provider | undefined): boolean {
  if (!provider) return false
  if (provider.hasApiKey === true) return true
  const apiKey = typeof provider.apiKey === 'string' ? provider.apiKey.trim() : ''
  return apiKey.length > 0
}

function shouldExposeModelForProvider(provider: Provider | undefined, model: CustomModel): boolean {
  if (!provider) return false
  return ALLOWED_PROVIDER_KEYS.has(getProviderKey(provider.id)) && isProviderModelType(model.type)
}

export function useApiConfigFilters({
  providers,
  models,
}: UseApiConfigFiltersParams) {
  const modelProviderKeys = useMemo(() => {
    const keys = new Set<string>(MODEL_PROVIDER_KEYS)
    models.forEach((model) => {
      if (!isProviderModelType(model.type)) return
      keys.add(getProviderKey(model.provider))
    })
    return keys
  }, [models])

  const isPresetProvider = (providerId: string) => {
    // Built-in catalog providers use plain ids without ':'.
    return !providerId.includes(':')
  }

  const modelProviders = useMemo(() => {
    return providers.filter((provider) => {
      const providerKey = getProviderKey(provider.id)
      if (!ALLOWED_PROVIDER_KEYS.has(providerKey)) return false
      const isCustomProvider = !isPresetProvider(provider.id)

      return (
        (isCustomProvider && modelProviderKeys.has(providerKey)) ||
        modelProviderKeys.has(providerKey) ||
        ALWAYS_SHOW_PROVIDERS.includes(providerKey)
      )
    })
  }, [modelProviderKeys, providers])

  const enabledModelsByType = useMemo(() => {
    const grouped: Record<'llm' | 'image' | 'video' | 'music' | 'sound', EnabledModelOption[]> = {
      llm: [],
      image: [],
      video: [],
      music: [],
      sound: [],
    }

    const providersById = new Map(providers.map((provider) => [provider.id, provider] as const))

    for (const model of models) {
      if (!model.enabled) continue
      if (!isDefaultModelType(model.type)) continue
      const provider = providersById.get(model.provider)
      if (!hasProviderApiKey(provider)) continue
      if (!shouldExposeModelForProvider(provider, model)) continue

      const option: EnabledModelOption = {
        ...model,
        providerName: provider?.name || model.provider,
      }

      grouped[model.type].push(option)
    }

    return grouped
  }, [models, providers])

  const providersById = useMemo(() => new Map(providers.map((provider) => [provider.id, provider] as const)), [providers])

  return {
    modelProviders,
    getModelsForProvider: (providerId: string) =>
      models.filter((model) => model.provider === providerId && shouldExposeModelForProvider(providersById.get(providerId), model)),
    getEnabledModelsByType: (type: 'llm' | 'image' | 'video' | 'music' | 'sound') => enabledModelsByType[type],
  }
}
