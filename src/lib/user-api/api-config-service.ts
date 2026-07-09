/**
 * 用户 API 配置管理接口
 *
 * GET  - 读取用户配置(解密)
 * PUT  - 保存/更新配置(加密)
 */

import { prisma } from '@/lib/prisma'
import { encryptApiKey, decryptApiKey } from '@/lib/crypto-utils'
import { ApiError } from '@/lib/api-errors'
import { buildApiConfigServerCatalog } from '@/lib/ai-registry/api-config-catalog'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { getBillingMode } from '@/lib/billing/mode'
import { getDeploymentConfig, isPlatformProviderCredentialMode, toPublicDeploymentConfig } from '@/lib/deployment/config'
import { normalizeWorkflowConcurrencyConfig } from '@/lib/workflow-concurrency'
import { getDefaultWorkflowConcurrencyConfig } from '@/lib/workflow-concurrency-env'
import type { ApiConfigPutBody, DefaultModelsPayload } from './api-config-types'
import { isRecord } from './api-config-shared'
import { parseStoredProviders, normalizeProvidersInput } from './api-config-provider-normalization'
import {
  normalizeModelList,
  parseStoredModels,
  validateBillableModelPricing,
  validateModelProviderConsistency,
  validateModelProviderTypeSupport,
} from './api-config-model-normalization'
import {
  buildPricingDisplayMap,
  resolveBuiltinCapabilities,
  withDisplayPricing,
} from './api-config-pricing-display'
import {
  normalizeDefaultModelsInput,
  normalizeWorkflowConcurrencyInput,
  sanitizeDefaultModelsAgainstModels,
  sanitizeDefaultModelsForBilling,
  sanitizeModelsForBilling,
  validateDefaultModelsAgainstModels,
  validateDefaultModelPricing,
} from './api-config-defaults'
import {
  normalizeCapabilitySelectionsInput,
  parseStoredCapabilitySelections,
  sanitizeCapabilitySelectionsAgainstModels,
  serializeCapabilitySelections,
  validateCapabilitySelectionsAgainstModels,
} from './api-config-capability-defaults'

export async function getUserApiConfig(userId: string) {
  const pref = await prisma.userPreference.findUnique({
    where: { userId },
    select: {
      customModels: true,
      customProviders: true,
      assistantModel: true,
      analysisModel: true,
      characterModel: true,
      locationModel: true,
      storyboardModel: true,
      editModel: true,
      videoModel: true,
      musicModel: true,
      capabilityDefaults: true,
      analysisConcurrency: true,
      imageConcurrency: true,
      videoConcurrency: true,
    },
  })

  const providers = parseStoredProviders(pref?.customProviders).map((provider) => ({
    ...provider,
    apiKey: provider.apiKey ? decryptApiKey(provider.apiKey) : '',
  }))

  const billingMode = await getBillingMode()
  const deployment = getDeploymentConfig()
  const parsedModels = parseStoredModels(pref?.customModels)
  const models = billingMode === 'OFF' ? parsedModels : sanitizeModelsForBilling(parsedModels)
  const pricingDisplay = buildPricingDisplayMap()
  const pricedModels = models.map((model) => withDisplayPricing(model, pricingDisplay))

  const rawDefaults: DefaultModelsPayload = {
    assistantModel: pref?.assistantModel || '',
    analysisModel: pref?.analysisModel || '',
    characterModel: pref?.characterModel || '',
    locationModel: pref?.locationModel || '',
    storyboardModel: pref?.storyboardModel || '',
    editModel: pref?.editModel || '',
    videoModel: pref?.videoModel || '',
    musicModel: pref?.musicModel || '',
  }
  const defaultModels = billingMode === 'OFF'
    ? rawDefaults
    : sanitizeDefaultModelsForBilling(rawDefaults)
  const enabledDefaultModels = sanitizeDefaultModelsAgainstModels(defaultModels, models)
  const capabilityDefaults = sanitizeCapabilitySelectionsAgainstModels(
    parseStoredCapabilitySelections(pref?.capabilityDefaults, 'capabilityDefaults'),
    models,
  )
  const workflowConcurrency = normalizeWorkflowConcurrencyConfig({
    analysis: pref?.analysisConcurrency,
    image: pref?.imageConcurrency,
    video: pref?.videoConcurrency,
  }, getDefaultWorkflowConcurrencyConfig())

  return {
    models: pricedModels,
    providers,
    catalog: buildApiConfigServerCatalog({
      resolveCapabilities: (model) => resolveBuiltinCapabilities(model.type, model.provider, model.modelId),
    }),
    defaultModels: enabledDefaultModels,
    capabilityDefaults,
    workflowConcurrency,
    pricingDisplay,
    deployment: toPublicDeploymentConfig(deployment),
  }
}

export async function putUserApiConfig(userId: string, body: unknown) {
  if (!isRecord(body)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'BODY_PARSE_FAILED',
      field: 'body',
    })
  }
  const payload = body as ApiConfigPutBody

  const normalizedModelsInput = payload.models === undefined ? undefined : normalizeModelList(payload.models)
  const normalizedProviders = payload.providers === undefined ? undefined : normalizeProvidersInput(payload.providers)
  const normalizedDefaults = payload.defaultModels === undefined ? undefined : normalizeDefaultModelsInput(payload.defaultModels)
  const normalizedCapabilityDefaults = payload.capabilityDefaults === undefined
    ? undefined
    : normalizeCapabilitySelectionsInput(payload.capabilityDefaults)
  const normalizedWorkflowConcurrency = payload.workflowConcurrency === undefined
    ? undefined
    : normalizeWorkflowConcurrencyInput(payload.workflowConcurrency)
  const billingMode = await getBillingMode()
  const deployment = getDeploymentConfig()
  if (isPlatformProviderCredentialMode(deployment)) {
    throw new ApiError('FORBIDDEN', {
      code: 'API_CONFIG_MANAGED_BY_PLATFORM',
    })
  }

  const updateData: Record<string, unknown> = {}
  const existingPref = await prisma.userPreference.findUnique({
    where: { userId },
    select: {
      customProviders: true,
      customModels: true,
      assistantModel: true,
      analysisModel: true,
      characterModel: true,
      locationModel: true,
      storyboardModel: true,
      editModel: true,
      videoModel: true,
      musicModel: true,
    },
  })
  const existingProviders = parseStoredProviders(existingPref?.customProviders)
  const existingModels = parseStoredModels(existingPref?.customModels)
  const normalizedModels = normalizedModelsInput

  const providerSourceForValidation = normalizedProviders ?? existingProviders
  if (normalizedModels !== undefined) {
    validateModelProviderConsistency(normalizedModels, providerSourceForValidation)
    validateModelProviderTypeSupport(normalizedModels, providerSourceForValidation)
    if (billingMode !== 'OFF') {
      validateBillableModelPricing(normalizedModels)
    }
  }

  if (normalizedModels !== undefined) {
    updateData.customModels = JSON.stringify(normalizedModels)
  }

  if (normalizedProviders !== undefined) {
    const providersToSave = normalizedProviders.map((provider) => {
      const existing = existingProviders.find((candidate) => candidate.id === provider.id)
      let finalApiKey: string | undefined
      if (provider.apiKey === undefined) {
        finalApiKey = existing?.apiKey
      } else if (provider.apiKey === '') {
        finalApiKey = undefined
      } else {
        finalApiKey = encryptApiKey(provider.apiKey)
      }
      const finalHidden = provider.hidden === undefined
        ? existing?.hidden === true
        : provider.hidden === true

      return {
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        hidden: finalHidden,
        apiKey: finalApiKey,
      }
    })
    updateData.customProviders = JSON.stringify(providersToSave)
  }

  if (normalizedDefaults !== undefined) {
    const modelSource = billingMode === 'OFF'
      ? (normalizedModels ?? existingModels)
      : sanitizeModelsForBilling(normalizedModels ?? existingModels)
    validateDefaultModelsAgainstModels(normalizedDefaults, modelSource)
    if (billingMode !== 'OFF') {
      validateDefaultModelPricing(normalizedDefaults)
    }
    if (normalizedDefaults.assistantModel !== undefined) {
      updateData.assistantModel = normalizedDefaults.assistantModel || null
    }
    if (normalizedDefaults.analysisModel !== undefined) {
      updateData.analysisModel = normalizedDefaults.analysisModel || null
    }
    if (normalizedDefaults.characterModel !== undefined) {
      updateData.characterModel = normalizedDefaults.characterModel || null
    }
    if (normalizedDefaults.locationModel !== undefined) {
      updateData.locationModel = normalizedDefaults.locationModel || null
    }
    if (normalizedDefaults.storyboardModel !== undefined) {
      updateData.storyboardModel = normalizedDefaults.storyboardModel || null
    }
    if (normalizedDefaults.editModel !== undefined) {
      updateData.editModel = normalizedDefaults.editModel || null
    }
    if (normalizedDefaults.videoModel !== undefined) {
      updateData.videoModel = normalizedDefaults.videoModel || null
    }
    if (normalizedDefaults.musicModel !== undefined) {
      updateData.musicModel = normalizedDefaults.musicModel || null
    }
  }

  if (normalizedModels !== undefined) {
    const modelSource = billingMode === 'OFF'
      ? normalizedModels
      : sanitizeModelsForBilling(normalizedModels)
    const existingDefaults: DefaultModelsPayload = {
      assistantModel: existingPref?.assistantModel || '',
      analysisModel: existingPref?.analysisModel || '',
      characterModel: existingPref?.characterModel || '',
      locationModel: existingPref?.locationModel || '',
      storyboardModel: existingPref?.storyboardModel || '',
      editModel: existingPref?.editModel || '',
      videoModel: existingPref?.videoModel || '',
      musicModel: existingPref?.musicModel || '',
    }
    const nextDefaults = {
      ...existingDefaults,
      ...(normalizedDefaults || {}),
    }
    const cleanedDefaults = sanitizeDefaultModelsAgainstModels(nextDefaults, modelSource)
    for (const field of Object.keys(cleanedDefaults) as Array<keyof DefaultModelsPayload>) {
      const cleanedValue = cleanedDefaults[field]
      if (cleanedValue === undefined) continue
      if (nextDefaults[field] === cleanedValue) continue
      updateData[field] = cleanedValue || null
    }
  }

  if (normalizedWorkflowConcurrency !== undefined) {
    if (normalizedWorkflowConcurrency.analysis !== undefined) {
      updateData.analysisConcurrency = normalizedWorkflowConcurrency.analysis
    }
    if (normalizedWorkflowConcurrency.image !== undefined) {
      updateData.imageConcurrency = normalizedWorkflowConcurrency.image
    }
    if (normalizedWorkflowConcurrency.video !== undefined) {
      updateData.videoConcurrency = normalizedWorkflowConcurrency.video
    }
  }

  if (normalizedCapabilityDefaults !== undefined) {
    const modelSource = normalizedModels ?? existingModels
    const cleanedCapabilityDefaults = sanitizeCapabilitySelectionsAgainstModels(
      normalizedCapabilityDefaults,
      modelSource,
    )
    validateCapabilitySelectionsAgainstModels(cleanedCapabilityDefaults, modelSource)
    updateData.capabilityDefaults = serializeCapabilitySelections(cleanedCapabilityDefaults)
  }

  await prisma.userPreference.upsert({
    where: { userId },
    update: updateData,
    create: { userId, ...updateData },
  })

  return { success: true }
}
ensureAiCatalogsRegistered()
