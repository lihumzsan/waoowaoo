/**
 * 用户 API 配置管理接口
 *
 * GET  - 读取用户配置(解密)
 * PUT  - 保存/更新配置(加密)
 */

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { encryptApiKey } from '@/lib/crypto-utils'
import { ApiError } from '@/lib/api-errors'
import { buildApiConfigServerCatalog } from '@/lib/ai-registry/api-config-catalog'
import type { CapabilitySelections } from '@/lib/ai-registry/types'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import {
  getDeploymentConfig,
  isSelfHostedUserProviderCredentialMode,
  toPublicDeploymentConfig,
} from '@/lib/deployment/config'
import { requireSelectableVideoModel } from '@/lib/model-access/selectable-video-model'
import { normalizeWorkflowConcurrencyConfig } from '@/lib/workflow-concurrency'
import { getDefaultWorkflowConcurrencyConfig } from '@/lib/workflow-concurrency-env'
import type { ApiConfigPutBody, DefaultModelsPayload } from './api-config-types'
import { isRecord } from './api-config-shared'
import { parseStoredProviders, normalizeProvidersInput } from './api-config-provider-normalization'
import {
  normalizeModelList,
  parseStoredModels,
  validateModelProviderConsistency,
  validateModelProviderTypeSupport,
} from './api-config-model-normalization'
import {
  resolveBuiltinCapabilities,
} from './api-config-capabilities'
import {
  normalizeDefaultModelsInput,
  normalizeWorkflowConcurrencyInput,
  sanitizeDefaultModelsAgainstModels,
  validateDefaultModelsAgainstModels,
} from './api-config-defaults'
import {
  parseStoredCapabilitySelections,
  sanitizeCapabilitySelectionsAgainstModels,
  serializeCapabilitySelections,
  validateCapabilitySelectionsAgainstModels,
} from './api-config-capability-defaults'
import {
  capabilitySelectionCommandSchema,
  capabilitySelectionCommandToSelections,
} from '@/lib/ai-registry/capability-selection-command'
import { assertUserProviderConfigurationAvailable } from './availability'
import {
  buildLocalProjectCapabilitySelections,
  LOCAL_PROJECT_DEFAULT_MODELS,
} from '@/lib/projects/creation-defaults'
import { CODEX_PLATFORM_DEFAULT_ASSISTANT_MODEL_KEY } from '@/lib/ai-providers/codex/models'
import {
  COMFYUI_H3_DEFAULT_GENERATION_OPTIONS,
  COMFYUI_PLATFORM_DEFAULT_VIDEO_MODEL_KEY,
} from '@/lib/ai-providers/comfyui/models'
import {
  DEFAULT_MODEL_FIELDS,
  type DefaultModelField,
  type DefaultModelSource,
  type EffectiveDefaultModelsView,
} from './api-config-types'

function buildEffectiveDefaultModelsView(input: {
  deployment: ReturnType<typeof getDeploymentConfig>
  explicitDefaultModels: DefaultModelsPayload
  explicitCapabilityDefaults: CapabilitySelections
}): EffectiveDefaultModelsView {
  const systemDefaultModels: DefaultModelsPayload = isSelfHostedUserProviderCredentialMode(input.deployment)
    ? {
        assistantModel: CODEX_PLATFORM_DEFAULT_ASSISTANT_MODEL_KEY,
        ...LOCAL_PROJECT_DEFAULT_MODELS,
      }
    : {}
  const defaultModels: DefaultModelsPayload = { ...systemDefaultModels }
  for (const field of DEFAULT_MODEL_FIELDS) {
    const explicitValue = input.explicitDefaultModels[field]
    if (explicitValue) defaultModels[field] = explicitValue
  }
  const sources = Object.fromEntries(DEFAULT_MODEL_FIELDS.map((field) => {
    let source: DefaultModelSource = 'unset'
    if (input.explicitDefaultModels[field]) source = 'user'
    else if (systemDefaultModels[field]) source = 'system'
    return [field, source]
  })) as Record<DefaultModelField, DefaultModelSource>
  const systemCapabilityDefaults: CapabilitySelections = isSelfHostedUserProviderCredentialMode(input.deployment)
    ? {
        ...buildLocalProjectCapabilitySelections({}),
        [COMFYUI_PLATFORM_DEFAULT_VIDEO_MODEL_KEY]: {
          ...COMFYUI_H3_DEFAULT_GENERATION_OPTIONS,
        },
      }
    : {}
  const capabilityDefaults = { ...systemCapabilityDefaults }
  for (const [modelKey, selection] of Object.entries(input.explicitCapabilityDefaults)) {
    capabilityDefaults[modelKey] = {
      ...(capabilityDefaults[modelKey] || {}),
      ...selection,
    }
  }
  return {
    defaultModels,
    capabilityDefaults,
    sources,
    runtimeManagedModelKeys: Array.from(new Set(Object.values(systemDefaultModels).filter(Boolean))),
  }
}

type ApiConfigReadClient = Pick<Prisma.TransactionClient, 'userPreference'>

async function readUserApiConfig(
  userId: string,
  client: ApiConfigReadClient,
) {
  const pref = await client.userPreference.findUnique({
    where: { userId },
    select: {
      customModels: true,
      customProviders: true,
      assistantModel: true,
      analysisModel: true,
      characterModel: true,
      locationModel: true,
      editModel: true,
      videoModel: true,
      musicModel: true,
      soundModel: true,
      capabilityDefaults: true,
      analysisConcurrency: true,
      imageConcurrency: true,
      videoConcurrency: true,
    },
  })

  const providers = parseStoredProviders(pref?.customProviders).map((provider) => ({
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    hidden: provider.hidden,
    hasApiKey: Boolean(provider.apiKey),
  }))

  const deployment = getDeploymentConfig()
  const parsedModels = parseStoredModels(pref?.customModels)
  const models = parsedModels

  const rawDefaults: DefaultModelsPayload = {
    assistantModel: pref?.assistantModel || '',
    analysisModel: pref?.analysisModel || '',
    characterModel: pref?.characterModel || '',
    locationModel: pref?.locationModel || '',
    editModel: pref?.editModel || '',
    videoModel: pref?.videoModel || '',
    musicModel: pref?.musicModel || '',
    soundModel: pref?.soundModel || '',
  }
  const defaultModels = rawDefaults
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
    models,
    providers,
    catalog: buildApiConfigServerCatalog({
      resolveCapabilities: (model) => resolveBuiltinCapabilities(model.type, model.provider, model.modelId),
    }),
    defaultModels: enabledDefaultModels,
    capabilityDefaults,
    effectiveDefaults: buildEffectiveDefaultModelsView({
      deployment,
      explicitDefaultModels: enabledDefaultModels,
      explicitCapabilityDefaults: capabilityDefaults,
    }),
    workflowConcurrency,
    deployment: toPublicDeploymentConfig(deployment),
  }
}

export async function getUserApiConfig(userId: string) {
  assertUserProviderConfigurationAvailable()
  return await readUserApiConfig(userId, prisma)
}

export async function putUserApiConfig(
  userId: string,
  body: unknown,
  client: Pick<Prisma.TransactionClient, 'userPreference'> = prisma,
) {
  assertUserProviderConfigurationAvailable()
  const deployment = getDeploymentConfig()
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
  const parsedCapabilityDefaults = payload.capabilityDefaults === undefined
    ? undefined
    : capabilitySelectionCommandSchema.safeParse(payload.capabilityDefaults)
  if (parsedCapabilityDefaults && !parsedCapabilityDefaults.success) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'CAPABILITY_DEFAULTS_PARSE_FAILED',
      field: 'capabilityDefaults',
      issues: parsedCapabilityDefaults.error.issues,
    })
  }
  const normalizedCapabilityDefaults = parsedCapabilityDefaults?.success
    ? capabilitySelectionCommandToSelections(parsedCapabilityDefaults.data)
    : undefined
  const normalizedWorkflowConcurrency = payload.workflowConcurrency === undefined
    ? undefined
    : normalizeWorkflowConcurrencyInput(payload.workflowConcurrency)
  const updateData: Record<string, unknown> = {}
  const existingPref = await client.userPreference.findUnique({
    where: { userId },
    select: {
      customProviders: true,
      customModels: true,
      assistantModel: true,
      analysisModel: true,
      characterModel: true,
      locationModel: true,
      editModel: true,
      videoModel: true,
      musicModel: true,
      soundModel: true,
    },
  })
  const existingProviders = parseStoredProviders(existingPref?.customProviders)
  const existingModels = parseStoredModels(existingPref?.customModels)
  const normalizedModels = normalizedModelsInput

  const providerSourceForValidation = normalizedProviders ?? existingProviders
  if (normalizedModels !== undefined) {
    validateModelProviderConsistency(normalizedModels, providerSourceForValidation)
    validateModelProviderTypeSupport(normalizedModels, providerSourceForValidation)
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
    const modelSource = normalizedModels ?? existingModels
    validateDefaultModelsAgainstModels(normalizedDefaults, modelSource)
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
    if (normalizedDefaults.editModel !== undefined) {
      updateData.editModel = normalizedDefaults.editModel || null
    }
    if (normalizedDefaults.videoModel !== undefined) {
      updateData.videoModel = (
        normalizedDefaults.videoModel
        && isSelfHostedUserProviderCredentialMode(deployment)
      )
        ? await requireSelectableVideoModel(userId, normalizedDefaults.videoModel)
        : normalizedDefaults.videoModel || null
    }
    if (normalizedDefaults.musicModel !== undefined) {
      updateData.musicModel = normalizedDefaults.musicModel || null
    }
    if (normalizedDefaults.soundModel !== undefined) {
      updateData.soundModel = normalizedDefaults.soundModel || null
    }
  }

  if (normalizedModels !== undefined) {
    const modelSource = normalizedModels
    const existingDefaults: DefaultModelsPayload = {
      assistantModel: existingPref?.assistantModel || '',
      analysisModel: existingPref?.analysisModel || '',
      characterModel: existingPref?.characterModel || '',
      locationModel: existingPref?.locationModel || '',
      editModel: existingPref?.editModel || '',
      videoModel: existingPref?.videoModel || '',
      musicModel: existingPref?.musicModel || '',
      soundModel: existingPref?.soundModel || '',
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

  await client.userPreference.upsert({
    where: { userId },
    update: updateData,
    create: { userId, ...updateData },
  })

  return await readUserApiConfig(userId, client)
}
ensureAiCatalogsRegistered()
