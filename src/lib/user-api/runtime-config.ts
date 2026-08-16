/**
 * API 配置读取器（配置中心严格模式）
 *
 * 规则：
 * 1) 模型唯一键必须是 provider::modelId
 * 2) 禁止 provider 猜测、静态映射、默认降级
 * 3) 运行时只从配置中心读取 provider 与密钥
 */

import { prisma } from '@/lib/prisma'
import { isApiConfigCatalogProviderId } from '@/lib/ai-registry/api-config-catalog'
import { parseModelKeyStrict } from '@/lib/ai-registry/selection'
import {
  getDeploymentConfig,
  isPlatformProviderCredentialMode,
  isSelfHostedUserProviderCredentialMode,
} from '@/lib/deployment/config'
import { getPlatformModels, getSelectableLocalVideoModels } from '@/lib/platform-models/catalog'
import type { UnifiedModelType } from '@/lib/ai-registry/types'
import { isUnifiedModelType } from '@/lib/user-api/api-config-shared'
import { AppError } from '@/lib/errors/app-error'
import { resolveComfyUiRuntimeTarget } from '@/lib/ai-providers/comfyui/config'
import { resolveComfyUiRuntimeTargetIdForModelKey } from '@/lib/ai-providers/comfyui/models'
import {
  findRuntimeModelByKey,
  resolveRuntimeModelSelection,
  resolveSingleRuntimeModelSelection,
  type RuntimeModelMediaType,
  type RuntimeModelSelection,
} from '@/lib/ai-registry/runtime-selection'

export interface CustomModel {
  modelId: string
  modelKey: string
  name: string
  type: UnifiedModelType
  provider: string
}

export type ModelMediaType = RuntimeModelMediaType
export type ModelSelection = RuntimeModelSelection

function isPlainObject(value: unknown): value is object {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function assertModelKey(value: string, field: string): { provider: string; modelId: string; modelKey: string } {
  const parsed = parseModelKeyStrict(value)
  if (!parsed) {
    throw new Error(`MODEL_KEY_INVALID: ${field} must be provider::modelId`)
  }
  return parsed
}

function normalizeStoredModel(raw: unknown, index: number): CustomModel {
  if (!isPlainObject(raw)) {
    throw new Error(`MODEL_PAYLOAD_INVALID: customModels[${index}] must be object`)
  }

  const modelKeyRaw = readTrimmedString(Reflect.get(raw, 'modelKey'))
  const parsed = assertModelKey(modelKeyRaw, `customModels[${index}].modelKey`)

  const modelId = parsed.modelId
  const provider = parsed.provider
  if (!isApiConfigCatalogProviderId(provider)) {
    throw new Error(`MODEL_PROVIDER_UNSUPPORTED: customModels[${index}].provider`)
  }

  const typeRaw = Reflect.get(raw, 'type')
  if (!isUnifiedModelType(typeRaw)) {
    throw new Error(`MODEL_PAYLOAD_INVALID: customModels[${index}].type must be one of llm/image/video/music/voice`)
  }

  return {
    modelId,
    modelKey: parsed.modelKey,
    provider,
    type: typeRaw,
    name: readTrimmedString(Reflect.get(raw, 'name')) || modelId,
  }
}

function parseCustomModels(rawModels: string | null | undefined): CustomModel[] {
  if (!rawModels) return []

  let parsedUnknown: unknown
  try {
    parsedUnknown = JSON.parse(rawModels)
  } catch {
    throw new Error('MODEL_PAYLOAD_INVALID: customModels is not valid JSON')
  }

  if (!Array.isArray(parsedUnknown)) {
    throw new Error('MODEL_PAYLOAD_INVALID: customModels must be an array')
  }

  const models: CustomModel[] = []
  for (let index = 0; index < parsedUnknown.length; index += 1) {
    models.push(normalizeStoredModel(parsedUnknown[index], index))
  }

  return models
}

async function readUserConfig(userId: string): Promise<{ models: CustomModel[] }> {
  const pref = await prisma.userPreference.findUnique({
    where: { userId },
    select: {
      customModels: true,
    },
  })

  return {
    models: parseCustomModels(pref?.customModels),
  }
}

function getDirectRuntimePlatformModels(mediaType?: ModelMediaType): CustomModel[] {
  const deployment = getDeploymentConfig()
  if (mediaType === 'video' && isSelfHostedUserProviderCredentialMode(deployment)) {
    return getSelectableLocalVideoModels()
  }
  if (mediaType === 'voice' || isPlatformProviderCredentialMode(deployment)) {
    return [...getPlatformModels()]
  }
  return getPlatformModels().filter((model) => (
    (model.provider === 'codex' || model.provider === 'comfyui')
    && (!mediaType || model.type === mediaType)
  ))
}

async function getRuntimeModels(userId: string, mediaType?: ModelMediaType): Promise<CustomModel[]> {
  const deployment = getDeploymentConfig()
  const directPlatformModels = getDirectRuntimePlatformModels(mediaType)
  // PG-16:voice 是平台固定模态,模型 identity 在任何凭证模式下都由平台目录唯一声明
  // (用户配置面不存在 voice 类型)。provider 凭证仍按部署模式解析:
  // user-key 部署用用户自己的 FAL provider key,缺失时报 PROVIDER_NOT_FOUND/API_KEY_MISSING,
  // 而不是误导性的 MODEL_NOT_FOUND。
  if (
    mediaType === 'voice'
    || (mediaType === 'video' && isSelfHostedUserProviderCredentialMode(deployment))
    || isPlatformProviderCredentialMode(deployment)
  ) {
    return directPlatformModels
  }

  const { models } = await readUserConfig(userId)
  return [
    ...directPlatformModels,
    ...models.filter((model) => model.provider !== 'codex'),
  ]
}

function findModelByKey(models: CustomModel[], modelKey: string): CustomModel | null {
  return findRuntimeModelByKey(models, modelKey)
}

/**
 * 统一模型选择解析（严格模式）
 */
export async function resolveModelSelection(
  userId: string,
  model: string,
  mediaType: ModelMediaType,
): Promise<ModelSelection> {
  const directPlatformModels = getDirectRuntimePlatformModels(mediaType)
  if (findModelByKey(directPlatformModels, model)) {
    return resolveRuntimeModelSelection(directPlatformModels, model, mediaType)
  }
  const models = await getRuntimeModels(userId, mediaType)
  return resolveRuntimeModelSelection(models, model, mediaType)
}

async function resolveSingleModelSelection(userId: string, mediaType: ModelMediaType): Promise<ModelSelection> {
  const models = await getRuntimeModels(userId, mediaType)
  return resolveSingleRuntimeModelSelection(models, mediaType)
}

/**
 * 统一模型选择解析（允许显式 model_key；未传时仅允许单模型）
 */
export async function resolveModelSelectionOrSingle(
  userId: string,
  model: string | null | undefined,
  mediaType: ModelMediaType,
): Promise<ModelSelection> {
  const modelKey = readTrimmedString(model)
  if (!modelKey) {
    return await resolveSingleModelSelection(userId, mediaType)
  }
  return await resolveModelSelection(userId, modelKey, mediaType)
}

/**
 * Provider 配置
 *
 * 返回 provider 的完整连接信息（apiKey 已解密）。
 * baseUrl 为可选，不同 provider 需求不同，由调用方自行校验。
 *
 * ⚠️ 调用方必须先通过 resolveModelSelection 校验模型归属，
 * 再使用 selection.provider 调用本函数，禁止直接传入未校验的 providerId。
 */
export interface ProviderConfig {
  id: string
  name: string
  apiKey: string
  baseUrl?: string
}

export async function getProviderConfig(userId: string, providerId: string, modelKey?: string): Promise<ProviderConfig> {
  if (providerId === 'codex') {
    return {
      id: providerId,
      name: 'Codex',
      apiKey: '',
    }
  }

  if (providerId === 'comfyui') {
    if (!modelKey) throw new AppError('INVALID_PARAMS', 'ComfyUI model key is required for runtime target resolution', { provider: providerId })
    const targetId = resolveComfyUiRuntimeTargetIdForModelKey(modelKey)
    const baseUrl = resolveComfyUiRuntimeTarget(targetId).baseUrl
    return {
      id: providerId,
      name: 'ComfyUI',
      apiKey: '',
      baseUrl,
    }
  }

  throw new AppError('PROVIDER_AUTH_INVALID', `Provider is not available locally: ${providerId}`, {
    provider: providerId,
  })
}

export async function getUserModels(userId: string): Promise<CustomModel[]> {
  return await getRuntimeModels(userId)
}

export async function getModelProvider(userId: string, model: string): Promise<string | null> {
  const models = await getRuntimeModels(userId)
  const matched = findModelByKey(models, model)
  return matched?.provider || null
}

export async function getModelsByType(userId: string, type: ModelMediaType): Promise<CustomModel[]> {
  const models = await getUserModels(userId)
  return models.filter((model) => model.type === type)
}

export async function hasApiConfig(userId: string): Promise<boolean> {
  await readUserConfig(userId)
  return true
}
