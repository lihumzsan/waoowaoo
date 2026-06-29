import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { getDeploymentConfig } from '@/lib/deployment/config'
import { getPlatformModels } from '@/lib/platform-models/catalog'
import {
  type CapabilityValue,
  type ModelCapabilities,
  type UnifiedModelType,
} from '@/lib/ai-registry/types'
import { composeModelKey, parseModelKeyStrict } from '@/lib/ai-registry/selection'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { findBuiltinCapabilities } from '@/lib/ai-registry/capabilities-catalog'
import { findBuiltinPricingCatalogEntry } from '@/lib/ai-registry/pricing-catalog'
import { type VideoPricingTier } from '@/lib/ai-registry/video-capabilities'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { CODEX_PROVIDER_KEY } from '@/lib/ai-registry/codex-defaults'
import { getProviderKey } from '@/lib/user-api/api-config-shared'

type StoredModelType = UnifiedModelType | string

interface StoredModel {
  modelId?: string
  modelKey?: string
  name?: string
  type?: StoredModelType
  provider?: string
}

interface StoredProvider {
  id?: string
  name?: string
  apiKey?: string
}

interface UserModelOption {
  value: string
  label: string
  provider?: string
  providerName?: string
  capabilities?: ModelCapabilities
  videoPricingTiers?: VideoPricingTier[]
}

interface UserModelsPayload {
  llm: UserModelOption[]
  image: UserModelOption[]
  video: UserModelOption[]
  music: UserModelOption[]
}

function isUnifiedModelType(type: unknown): type is UnifiedModelType {
  return (
    type === 'llm'
    || type === 'image'
    || type === 'video'
    || type === 'music'
  )
}

function toModelKey(model: StoredModel): string {
  const provider = typeof model.provider === 'string' ? model.provider.trim() : ''
  const modelId = typeof model.modelId === 'string' ? model.modelId.trim() : ''

  if (provider && modelId) {
    return composeModelKey(provider, modelId)
  }

  const parsed = parseModelKeyStrict(typeof model.modelKey === 'string' ? model.modelKey : '')
  return parsed?.modelKey || ''
}

function toProvider(model: StoredModel): string | undefined {
  if (typeof model.provider === 'string' && model.provider.trim()) return model.provider.trim()
  const parsed = parseModelKeyStrict(typeof model.modelKey === 'string' ? model.modelKey : '')
  return parsed?.provider || undefined
}

function toModelId(model: StoredModel): string {
  if (typeof model.modelId === 'string' && model.modelId.trim()) {
    return model.modelId.trim()
  }
  const parsed = parseModelKeyStrict(typeof model.modelKey === 'string' ? model.modelKey : '')
  return parsed?.modelId || ''
}

function toDisplayLabel(model: StoredModel, fallbackModelId: string): string {
  if (typeof model.name === 'string' && model.name.trim()) return model.name.trim()
  return fallbackModelId
}

function dedupeByModelKey(items: UserModelOption[]): UserModelOption[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.value)) return false
    seen.add(item.value)
    return true
  })
}

function cloneVideoPricingTiers(rawTiers: Array<{ when: Record<string, CapabilityValue> }>): VideoPricingTier[] {
  return rawTiers.map((tier) => ({
    when: { ...tier.when },
  }))
}

function parseStoredModels(rawModels: string | null | undefined): StoredModel[] {
  if (!rawModels) return []
  let parsedUnknown: unknown
  try {
    parsedUnknown = JSON.parse(rawModels)
  } catch {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MODEL_PAYLOAD_INVALID',
      field: 'customModels',
    })
  }
  if (!Array.isArray(parsedUnknown)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MODEL_PAYLOAD_INVALID',
      field: 'customModels',
    })
  }
  return parsedUnknown as StoredModel[]
}

function parseStoredProviders(rawProviders: string | null | undefined): StoredProvider[] {
  if (!rawProviders) return []
  let parsedUnknown: unknown
  try {
    parsedUnknown = JSON.parse(rawProviders)
  } catch {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROVIDER_PAYLOAD_INVALID',
      field: 'customProviders',
    })
  }
  if (!Array.isArray(parsedUnknown)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROVIDER_PAYLOAD_INVALID',
      field: 'customProviders',
    })
  }
  return parsedUnknown as StoredProvider[]
}

function hasStoredProviderApiKey(provider: StoredProvider): boolean {
  return typeof provider.apiKey === 'string' && provider.apiKey.trim().length > 0
}

function isStoredProviderRuntimeReady(provider: StoredProvider): boolean {
  const providerId = typeof provider.id === 'string' ? provider.id.trim() : ''
  if (!providerId) return false
  if (getProviderKey(providerId) === CODEX_PROVIDER_KEY) return true
  return hasStoredProviderApiKey(provider)
}

async function resolveModelSource(userId: string): Promise<{
  deploymentMode: 'platform-key' | 'user-key'
  models: StoredModel[]
  providers: StoredProvider[]
}> {
  const deployment = getDeploymentConfig()
  if (deployment.providerCredentialMode === 'platform-key') {
    return {
      deploymentMode: 'platform-key',
      models: getPlatformModels(),
      providers: [],
    }
  }

  const pref = await prisma.userPreference.findUnique({
    where: { userId },
    select: { customModels: true, customProviders: true },
  })

  return {
    deploymentMode: 'user-key',
    models: parseStoredModels(pref?.customModels),
    providers: parseStoredProviders(pref?.customProviders),
  }
}

export function createUserModelsOperations(): ProjectAgentOperationRegistryDraft {
  return {
    list_user_models: {
      id: 'list_user_models',
      summary: 'List runtime-enabled models for config dropdowns.',
      intent: 'query',
      effects: {
        writes: false,
        billable: false,
        destructive: false,
        overwrite: false,
        bulk: false,
        externalSideEffects: false,
        longRunning: false,
      },
      inputSchema: z.object({}).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx) => {
        const modelSource = await resolveModelSource(ctx.userId)
        const providerNameMap = new Map<string, string>()
        const runtimeReadyProviderKeys = new Set<string>()
        modelSource.providers.forEach((provider) => {
          const providerId = typeof provider?.id === 'string' ? provider.id.trim() : ''
          if (!providerId) return
          const providerKey = getProviderKey(providerId)

          if (provider?.name && typeof provider.name === 'string') {
            providerNameMap.set(providerKey, provider.name)
          }
          if (isStoredProviderRuntimeReady(provider)) runtimeReadyProviderKeys.add(providerKey)
        })

        const grouped: UserModelsPayload = {
          llm: [],
          image: [],
          video: [],
          music: [],
        }

        for (const model of modelSource.models) {
          if (!isUnifiedModelType(model.type)) continue

          const modelType = model.type
          const modelKey = toModelKey(model)
          if (!modelKey) continue

          const provider = toProvider(model)
          if (!provider) continue
          const providerKey = getProviderKey(provider)
          if (modelSource.deploymentMode !== 'platform-key' && !runtimeReadyProviderKeys.has(providerKey)) continue
          const modelId = toModelId(model)
          const option: UserModelOption = {
            value: modelKey,
            label: toDisplayLabel(model, modelId || modelKey),
            provider,
            providerName: providerNameMap.get(providerKey),
          }

          if (provider && modelId) {
            const capabilities = findBuiltinCapabilities(modelType, provider, modelId)
            if (capabilities) {
              option.capabilities = capabilities
            }

            if (modelType === 'video') {
              const pricingEntry = findBuiltinPricingCatalogEntry('video', provider, modelId)
              if (pricingEntry?.pricing.mode === 'capability' && Array.isArray(pricingEntry.pricing.tiers)) {
                option.videoPricingTiers = cloneVideoPricingTiers(pricingEntry.pricing.tiers)
              }
            }
          }

          grouped[modelType].push(option)
        }

        return {
          llm: dedupeByModelKey(grouped.llm),
          image: dedupeByModelKey(grouped.image),
          video: dedupeByModelKey(grouped.video),
          music: dedupeByModelKey(grouped.music),
        } satisfies UserModelsPayload
      },
    },
  }
}
ensureAiCatalogsRegistered()
