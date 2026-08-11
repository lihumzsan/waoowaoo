import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { getDeploymentConfig, isPlatformProviderCredentialMode } from '@/lib/deployment/config'
import { getPlatformDefaultModelCatalog, getPlatformModels } from '@/lib/platform-models/catalog'
import {
  type ModelCapabilities,
  type UnifiedModelType,
} from '@/lib/ai-registry/types'
import { composeModelKey, parseModelKeyStrict } from '@/lib/ai-registry/selection'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { findBuiltinCapabilities } from '@/lib/ai-registry/capabilities-catalog'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'

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
}

interface UserModelsPayload {
  llm: UserModelOption[]
  image: UserModelOption[]
  video: UserModelOption[]
  music: UserModelOption[]
  sound: UserModelOption[]
}

type SelectableUserModelType = Exclude<UnifiedModelType, 'voice'>

function isSelectableUserModelType(type: unknown): type is SelectableUserModelType {
  return (
    type === 'llm'
    || type === 'image'
    || type === 'video'
    || type === 'music'
    || type === 'sound'
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

async function resolveModelSource(userId: string): Promise<{
  deploymentMode: 'platform-key' | 'user-key'
  models: StoredModel[]
  providers: StoredProvider[]
}> {
  const deployment = getDeploymentConfig()
  if (isPlatformProviderCredentialMode(deployment)) {
    return {
      deploymentMode: 'platform-key',
      models: getPlatformDefaultModelCatalog(),
      providers: [],
    }
  }

  const pref = await prisma.userPreference.findUnique({
    where: { userId },
    select: { customModels: true, customProviders: true },
  })

  return {
    deploymentMode: 'user-key',
    models: [
      ...getPlatformModels().filter((model) => model.provider === 'comfyui'),
      ...parseStoredModels(pref?.customModels),
    ],
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
        const providerIdsWithApiKey = new Set<string>()
        modelSource.providers.forEach((provider) => {
          const providerId = typeof provider?.id === 'string' ? provider.id.trim() : ''
          if (!providerId) return

          if (provider?.name && typeof provider.name === 'string') {
            providerNameMap.set(providerId, provider.name)
          }
          if (hasStoredProviderApiKey(provider)) providerIdsWithApiKey.add(providerId)
        })

        const grouped: UserModelsPayload = {
          llm: [],
          image: [],
          video: [],
          music: [],
          sound: [],
        }

        for (const model of modelSource.models) {
          if (!isSelectableUserModelType(model.type)) continue

          const modelType = model.type
          const modelKey = toModelKey(model)
          if (!modelKey) continue

          const provider = toProvider(model)
          if (!provider) continue
          if (
            modelSource.deploymentMode !== 'platform-key'
            && provider !== 'comfyui'
            && !providerIdsWithApiKey.has(provider)
          ) continue
          const modelId = toModelId(model)
          const option: UserModelOption = {
            value: modelKey,
            label: toDisplayLabel(model, modelId || modelKey),
            provider,
            providerName: provider ? providerNameMap.get(provider) : undefined,
          }

          if (provider && modelId) {
            const capabilities = findBuiltinCapabilities(modelType, provider, modelId)
            if (capabilities) {
              option.capabilities = capabilities
            }

          }

          grouped[modelType].push(option)
        }

        return {
          llm: dedupeByModelKey(grouped.llm),
          image: dedupeByModelKey(grouped.image),
          video: dedupeByModelKey(grouped.video),
          music: dedupeByModelKey(grouped.music),
          sound: dedupeByModelKey(grouped.sound),
        } satisfies UserModelsPayload
      },
    },
  }
}
ensureAiCatalogsRegistered()
