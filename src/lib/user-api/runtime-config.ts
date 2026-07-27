/**
 * API 配置读取器（配置中心严格模式）
 *
 * 规则：
 * 1) 模型唯一键必须是 provider::modelId
 * 2) 禁止 provider 猜测、静态映射、默认降级
 * 3) 运行时只从配置中心读取 provider 与密钥
 */

import { prisma } from '@/lib/prisma'
import { decryptApiKey } from '@/lib/crypto-utils'
import { parseModelKeyStrict } from '@/lib/ai-registry/selection'
import { getDeploymentConfig, isPlatformProviderCredentialMode } from '@/lib/deployment/config'
import PLATFORM_PROVIDER_ENV from '@/lib/deployment/platform-provider-env.json'
import { getPlatformModels } from '@/lib/platform-models/catalog'
import type { UnifiedModelType } from '@/lib/ai-registry/types'
import {
  findRuntimeModelByKey,
  normalizeProviderRuntimeBaseUrl,
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
  // Non-authoritative display field; billing uses unified server pricing catalog.
  price: number
}

export type ModelMediaType = RuntimeModelMediaType
export type ModelSelection = RuntimeModelSelection

interface CustomProvider {
  id: string
  name: string
  baseUrl?: string
  apiKey?: string
}

type PlatformProviderEnv = {
  apiKey: string
  baseUrl?: string
}

const SUPPORTED_PROVIDER_IDS = new Set(['ark', 'openrouter', 'fal', 'google', 'mureka'])

function isPlainObject(value: unknown): value is object {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readEnvString(name: string): string {
  return readTrimmedString(process.env[name])
}

function getProviderFamily(providerId: string): string {
  const trimmed = providerId.trim()
  const colonIndex = trimmed.indexOf(':')
  return colonIndex === -1 ? trimmed : trimmed.slice(0, colonIndex)
}

function resolvePlatformProviderEnv(providerId: string): PlatformProviderEnv {
  const providerFamily = getProviderFamily(providerId)
  const entry = (PLATFORM_PROVIDER_ENV as Record<string, { envPrefix: string; requiresBaseUrl?: boolean }>)[providerFamily]
  if (!entry) {
    throw new Error(`PLATFORM_PROVIDER_UNSUPPORTED: ${providerId}`)
  }

  const apiKey = readEnvString(`${entry.envPrefix}_API_KEY`)
  if (!apiKey) {
    throw new Error(`PLATFORM_PROVIDER_API_KEY_MISSING: ${providerId}`)
  }

  const baseUrl = readEnvString(`${entry.envPrefix}_BASE_URL`)
  if (entry.requiresBaseUrl && !baseUrl) {
    throw new Error(`PLATFORM_PROVIDER_BASE_URL_MISSING: ${providerId}`)
  }
  return {
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
  }
}

function isUnifiedModelType(value: unknown): value is UnifiedModelType {
  return (
    value === 'llm'
    || value === 'image'
    || value === 'video'
    || value === 'music'
  )
}

function assertModelKey(value: string, field: string): { provider: string; modelId: string; modelKey: string } {
  const parsed = parseModelKeyStrict(value)
  if (!parsed) {
    throw new Error(`MODEL_KEY_INVALID: ${field} must be provider::modelId`)
  }
  return parsed
}

function parseCustomProviders(rawProviders: string | null | undefined): CustomProvider[] {
  if (!rawProviders) return []

  let parsedUnknown: unknown
  try {
    parsedUnknown = JSON.parse(rawProviders)
  } catch {
    throw new Error('PROVIDER_PAYLOAD_INVALID: customProviders is not valid JSON')
  }

  if (!Array.isArray(parsedUnknown)) {
    throw new Error('PROVIDER_PAYLOAD_INVALID: customProviders must be an array')
  }

  const providers: CustomProvider[] = []
  for (let index = 0; index < parsedUnknown.length; index += 1) {
    const raw = parsedUnknown[index]
    if (!isPlainObject(raw)) {
      throw new Error(`PROVIDER_PAYLOAD_INVALID: customProviders[${index}] must be object`)
    }

    const id = readTrimmedString(Reflect.get(raw, 'id'))
    const name = readTrimmedString(Reflect.get(raw, 'name'))
    if (!id || !name) {
      throw new Error(`PROVIDER_PAYLOAD_INVALID: customProviders[${index}] id/name required`)
    }
    if (!SUPPORTED_PROVIDER_IDS.has(id)) {
      throw new Error(`PROVIDER_UNSUPPORTED: ${id}`)
    }

    const baseUrl = readTrimmedString(Reflect.get(raw, 'baseUrl')) || undefined
    const apiKey = readTrimmedString(Reflect.get(raw, 'apiKey')) || undefined
    providers.push({
      id,
      name,
      ...(baseUrl ? { baseUrl } : {}),
      ...(apiKey ? { apiKey } : {}),
    })
  }

  return providers
}

function normalizeStoredModel(raw: unknown, index: number): CustomModel {
  if (!isPlainObject(raw)) {
    throw new Error(`MODEL_PAYLOAD_INVALID: customModels[${index}] must be object`)
  }

  const modelKeyRaw = readTrimmedString(Reflect.get(raw, 'modelKey'))
  const parsed = assertModelKey(modelKeyRaw, `customModels[${index}].modelKey`)

  const modelId = parsed.modelId
  const provider = parsed.provider
  if (!SUPPORTED_PROVIDER_IDS.has(provider)) {
    throw new Error(`MODEL_PROVIDER_UNSUPPORTED: customModels[${index}].provider`)
  }

  const typeRaw = Reflect.get(raw, 'type')
  if (!isUnifiedModelType(typeRaw)) {
    throw new Error(`MODEL_PAYLOAD_INVALID: customModels[${index}].type must be one of llm/image/video/music`)
  }

  return {
    modelId,
    modelKey: parsed.modelKey,
    provider,
    type: typeRaw,
    name: readTrimmedString(Reflect.get(raw, 'name')) || modelId,
    price: 0,
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

function pickProviderStrict(providers: CustomProvider[], providerId: string): CustomProvider {
  const matched = providers.find((provider) => provider.id === providerId)
  if (matched) return matched

  throw new Error(`PROVIDER_NOT_FOUND: ${providerId} is not configured`)
}

async function readUserConfig(userId: string): Promise<{ models: CustomModel[]; providers: CustomProvider[] }> {
  const pref = await prisma.userPreference.findUnique({
    where: { userId },
    select: {
      customModels: true,
      customProviders: true,
    },
  })

  return {
    models: parseCustomModels(pref?.customModels),
    providers: parseCustomProviders(pref?.customProviders),
  }
}

async function getRuntimeModels(userId: string): Promise<CustomModel[]> {
  const deployment = getDeploymentConfig()
  if (isPlatformProviderCredentialMode(deployment)) {
    return getPlatformModels()
  }

  const { models } = await readUserConfig(userId)
  return models
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
  const models = await getRuntimeModels(userId)
  return resolveRuntimeModelSelection(models, model, mediaType)
}

async function resolveSingleModelSelection(userId: string, mediaType: ModelMediaType): Promise<ModelSelection> {
  const models = await getRuntimeModels(userId)
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

export async function getProviderConfig(userId: string, providerId: string): Promise<ProviderConfig> {
  const deployment = getDeploymentConfig()
  if (isPlatformProviderCredentialMode(deployment)) {
    const platform = resolvePlatformProviderEnv(providerId)
    return {
      id: providerId,
      name: providerId,
      apiKey: platform.apiKey,
      baseUrl: normalizeProviderRuntimeBaseUrl(providerId, platform.baseUrl),
    }
  }

  const { providers } = await readUserConfig(userId)
  const provider = pickProviderStrict(providers, providerId)

  if (!provider.apiKey) {
    throw new Error(`PROVIDER_API_KEY_MISSING: ${provider.id}`)
  }

  return {
    id: provider.id,
    name: provider.name,
    apiKey: decryptApiKey(provider.apiKey),
    baseUrl: normalizeProviderRuntimeBaseUrl(provider.id, provider.baseUrl),
  }
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

export async function resolveModelId(userId: string, model: string): Promise<string> {
  const selection = await resolveModelSelection(userId, model, 'llm')
  return selection.modelId
}

export async function getModelPrice(userId: string, model: string): Promise<number> {
  const models = await getRuntimeModels(userId)
  const matched = findModelByKey(models, model)
  if (!matched) {
    throw new Error(`MODEL_NOT_FOUND: ${model}`)
  }
  return matched.price
}

export async function hasApiConfig(userId: string): Promise<boolean> {
  if (isPlatformProviderCredentialMode()) return true

  const pref = await prisma.userPreference.findUnique({
    where: { userId },
    select: { customProviders: true },
  })

  const providers = parseCustomProviders(pref?.customProviders)
  return providers.some((provider) => !!provider.apiKey)
}
