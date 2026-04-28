/**
 * 获取用户的模型列表
 *
 * 返回用户在个人中心启用的模型，供项目配置下拉框使用。
 * capabilities 仅来自系统内置目录（不信任用户提交的 model.capabilities）。
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
  composeModelKey,
  parseModelKeyStrict,
  type CapabilityValue,
  type ModelCapabilities,
  type UnifiedModelType,
} from '@/lib/model-config-contract'
import { findBuiltinCapabilities } from '@/lib/model-capabilities/catalog'
import { findBuiltinPricingCatalogEntry } from '@/lib/model-pricing/catalog'
import type { VideoPricingTier } from '@/lib/model-pricing/video-tier'

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
  baseUrl?: string
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
  audio: UserModelOption[]
  lipsync: UserModelOption[]
}

const COMFYUI_AUTO_ENABLED_HELPER_MODELS: StoredModel[] = [
  {
    modelId: 'baseimage/图片编辑/qwen双图编辑',
    modelKey: 'comfyui::baseimage/图片编辑/qwen双图编辑',
    name: 'ComfyUI · Qwen 双图编辑',
    type: 'image',
    provider: 'comfyui',
  },
  {
    modelId: 'baseimage/图片编辑/qwen三图编辑',
    modelKey: 'comfyui::baseimage/图片编辑/qwen三图编辑',
    name: 'ComfyUI · Qwen 三图编辑',
    type: 'image',
    provider: 'comfyui',
  },
  {
    modelId: 'baseimage/图片编辑/Flux2多图编辑',
    modelKey: 'comfyui::baseimage/图片编辑/Flux2多图编辑',
    name: 'ComfyUI · Flux2 多图编辑',
    type: 'image',
    provider: 'comfyui',
  },
  {
    modelId: 'basevideo/多镜头/Ltx2.3多镜头时间+逻辑控制PromptRelay和VBVR（KJ版）1',
    modelKey: 'comfyui::basevideo/多镜头/Ltx2.3多镜头时间+逻辑控制PromptRelay和VBVR（KJ版）1',
    name: 'ComfyUI · LTX 2.3 多镜头 VBVR',
    type: 'video',
    provider: 'comfyui',
  },
  {
    modelId: 'basevideo/多镜头/Ltx2.3多镜头时间+逻辑控制PromptRelay+VBVR（KJ版）',
    modelKey: 'comfyui::basevideo/多镜头/Ltx2.3多镜头时间+逻辑控制PromptRelay+VBVR（KJ版）',
    name: 'ComfyUI · LTX 2.3 多镜头 自动拆分 VBVR',
    type: 'video',
    provider: 'comfyui',
  },
  {
    modelId: 'basevideo/多镜头/Ltx2.3多镜头精准时间控制PromptRelay（KJ版）',
    modelKey: 'comfyui::basevideo/多镜头/Ltx2.3多镜头精准时间控制PromptRelay（KJ版）',
    name: 'ComfyUI · LTX 2.3 多镜头 精准时间',
    type: 'video',
    provider: 'comfyui',
  },
]

const AUDIO_MODEL_EXCLUDED_IDS = new Set([
  'baseaudio/\u97f3\u8272/s2-se',
])

function isUnifiedModelType(type: unknown): type is UnifiedModelType {
  return (
    type === 'llm'
    || type === 'image'
    || type === 'video'
    || type === 'audio'
    || type === 'lipsync'
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

function getProviderKey(providerId?: string): string {
  if (!providerId) return ''
  const trimmed = providerId.trim()
  const colonIndex = trimmed.indexOf(':')
  return colonIndex === -1 ? trimmed : trimmed.slice(0, colonIndex)
}

function hasStoredProviderConnection(provider: StoredProvider): boolean {
  if (typeof provider.apiKey === 'string' && provider.apiKey.trim().length > 0) {
    return true
  }
  return getProviderKey(provider.id) === 'comfyui'
    && typeof provider.baseUrl === 'string'
    && provider.baseUrl.trim().length > 0
}

function isUserSelectableModel(model: StoredModel): boolean {
  if (model.type !== 'audio') return true
  const modelId = toModelId(model)
  return !AUDIO_MODEL_EXCLUDED_IDS.has(modelId)
}

function injectComfyUiHelperModels(models: StoredModel[], providers: StoredProvider[]): StoredModel[] {
  const hasConnectedComfyUi = providers.some(
    (provider) => getProviderKey(provider.id) === 'comfyui' && hasStoredProviderConnection(provider),
  )
  if (!hasConnectedComfyUi) return models

  const seenModelKeys = new Set(models.map((model) => toModelKey(model)))
  const helperModels = COMFYUI_AUTO_ENABLED_HELPER_MODELS.filter((model) => !seenModelKeys.has(toModelKey(model)))
  if (helperModels.length === 0) return models

  return [...models, ...helperModels]
}

export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const userId = session.user.id

  const pref = await prisma.userPreference.findUnique({
    where: { userId },
    select: { customModels: true, customProviders: true },
  })

  const providers: StoredProvider[] = parseStoredProviders(pref?.customProviders)
  const modelsRaw: StoredModel[] = injectComfyUiHelperModels(
    parseStoredModels(pref?.customModels),
    providers,
  )

  const providerNameMap = new Map<string, string>()
  const providerIdsWithConnection = new Set<string>()
  providers.forEach((provider) => {
    const providerId = typeof provider?.id === 'string' ? provider.id.trim() : ''
    if (!providerId) return

    if (provider?.name && typeof provider.name === 'string') {
      providerNameMap.set(providerId, provider.name)
    }
    if (hasStoredProviderConnection(provider)) providerIdsWithConnection.add(providerId)
  })

  const grouped: UserModelsPayload = {
    llm: [],
    image: [],
    video: [],
    audio: [],
    lipsync: [],
  }

  for (const model of modelsRaw) {
    if (!isUnifiedModelType(model.type)) continue
    if (!isUserSelectableModel(model)) continue

    const modelType = model.type
    const modelKey = toModelKey(model)
    if (!modelKey) continue

    const provider = toProvider(model)
    if (!provider || !providerIdsWithConnection.has(provider)) continue
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

      if (modelType === 'video') {
        const pricingEntry = findBuiltinPricingCatalogEntry('video', provider, modelId)
        if (pricingEntry?.pricing.mode === 'capability' && Array.isArray(pricingEntry.pricing.tiers)) {
          option.videoPricingTiers = cloneVideoPricingTiers(pricingEntry.pricing.tiers)
        }
      }
    }

    grouped[modelType].push(option)
  }

  return NextResponse.json({
    llm: dedupeByModelKey(grouped.llm),
    image: dedupeByModelKey(grouped.image),
    video: dedupeByModelKey(grouped.video),
    audio: dedupeByModelKey(grouped.audio),
    lipsync: dedupeByModelKey(grouped.lipsync),
  } satisfies UserModelsPayload)
})
