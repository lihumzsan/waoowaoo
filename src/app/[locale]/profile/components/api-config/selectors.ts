import type { CustomModel, Provider } from './types'
import { encodeModelKey, getProviderKey, isPresetComingSoonModelKey } from './types'
import type { CapabilitySelections, CapabilityValue } from '@/lib/ai-registry/types'
import {
  DEFAULT_ANALYSIS_WORKFLOW_CONCURRENCY,
  DEFAULT_IMAGE_WORKFLOW_CONCURRENCY,
  DEFAULT_VIDEO_WORKFLOW_CONCURRENCY,
  normalizeWorkflowConcurrencyValue,
} from '@/lib/workflow-concurrency'

export interface WorkflowConcurrency {
  analysis: number
  image: number
  video: number
}

export interface DefaultModels {
  analysisModel?: string
  characterModel?: string
  locationModel?: string
  editModel?: string
  videoModel?: string
  musicModel?: string
  soundModel?: string
}

export interface CapabilityFieldDefaults {
  field: string
  options: CapabilityValue[]
}

export const DEFAULT_MODEL_FIELDS = [
  'analysisModel',
  'characterModel',
  'locationModel',
  'editModel',
  'videoModel',
  'musicModel',
  'soundModel',
] as const satisfies ReadonlyArray<keyof DefaultModels>

export function createInitialProviders(presetProviders: Provider[]): Provider[] {
  return presetProviders.map((provider) => ({ ...provider, apiKey: '', hasApiKey: false }))
}

export function createInitialModels(presetModels: ReadonlyArray<Omit<CustomModel, 'modelKey' | 'enabled'> & Partial<Pick<CustomModel, 'modelKey' | 'enabled'>>>): CustomModel[] {
  return presetModels.map((model) => {
    const modelKey = encodeModelKey(model.provider, model.modelId)
    return {
      ...model,
      modelKey,
      enabled: !isPresetComingSoonModelKey(modelKey),
    }
  })
}

export function mergeProvidersForDisplay(
  savedProviders: Provider[],
  presetProviders: Provider[],
): Provider[] {
  const merged: Provider[] = []
  const seenProviderIds = new Set<string>()
  const seenPresetKeys = new Set<string>()

  for (const savedProvider of savedProviders) {
    if (seenProviderIds.has(savedProvider.id)) continue
    seenProviderIds.add(savedProvider.id)

    const providerKey = getProviderKey(savedProvider.id)
    const matchedPreset = presetProviders.find((presetProvider) => presetProvider.id === providerKey)
    if (matchedPreset) {
      merged.push({
        ...matchedPreset,
        hasApiKey: savedProvider.hasApiKey === true,
        hidden: savedProvider.hidden === true,
        baseUrl: savedProvider.baseUrl || matchedPreset.baseUrl,
      })
      seenPresetKeys.add(providerKey)
      continue
    }

    merged.push({
      ...savedProvider,
      apiKey: undefined,
      hasApiKey: savedProvider.hasApiKey === true,
    })
  }

  for (const presetProvider of presetProviders) {
    if (seenPresetKeys.has(presetProvider.id)) continue
    merged.push({
      ...presetProvider,
      apiKey: '',
      hasApiKey: false,
      hidden: false,
    })
  }

  return merged
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export const DEFAULT_WORKFLOW_CONCURRENCY: WorkflowConcurrency = {
  analysis: DEFAULT_ANALYSIS_WORKFLOW_CONCURRENCY,
  image: DEFAULT_IMAGE_WORKFLOW_CONCURRENCY,
  video: DEFAULT_VIDEO_WORKFLOW_CONCURRENCY,
}

export function parseWorkflowConcurrency(raw: unknown): WorkflowConcurrency {
  if (!isRecord(raw)) return DEFAULT_WORKFLOW_CONCURRENCY
  return {
    analysis: normalizeWorkflowConcurrencyValue(raw.analysis, DEFAULT_WORKFLOW_CONCURRENCY.analysis),
    image: normalizeWorkflowConcurrencyValue(raw.image, DEFAULT_WORKFLOW_CONCURRENCY.image),
    video: normalizeWorkflowConcurrencyValue(raw.video, DEFAULT_WORKFLOW_CONCURRENCY.video),
  }
}

export function normalizeSavedModels(savedModelsRaw: CustomModel[]): CustomModel[] {
  const savedModels: CustomModel[] = []
  const seen = new Set<string>()
  for (const model of savedModelsRaw) {
    const modelKey = model.modelKey || encodeModelKey(model.provider, model.modelId)
    if (seen.has(modelKey)) continue
    seen.add(modelKey)
    savedModels.push({ ...model, modelKey })
  }
  return savedModels
}

export function mergeModelsForDisplay(
  savedModelsRaw: CustomModel[],
  catalogModels: ReadonlyArray<Omit<CustomModel, 'modelKey' | 'enabled'> & Partial<Pick<CustomModel, 'modelKey' | 'enabled'>>>,
): CustomModel[] {
  const savedModels = normalizeSavedModels(savedModelsRaw)
  const hasSavedModels = savedModels.length > 0
  const catalogModelKeys = new Set(catalogModels.map((catalogModel) => encodeModelKey(catalogModel.provider, catalogModel.modelId)))

  const presetModels = catalogModels.map((preset) => {
    const presetModelKey = encodeModelKey(preset.provider, preset.modelId)
    const saved = savedModels.find((model) => model.modelKey === presetModelKey)
    const mergedPreset: CustomModel = {
      ...preset,
      modelKey: presetModelKey,
      enabled: isPresetComingSoonModelKey(presetModelKey)
        ? false
        : (hasSavedModels ? !!saved : false),
      capabilities: saved?.capabilities ?? preset.capabilities,
    }
    return mergedPreset
  })

  const customModels = savedModels
    .filter((model) => !catalogModelKeys.has(model.modelKey))
    .map((model) => ({
      ...model,
      enabled: model.enabled !== false,
    }))

  return [...presetModels, ...customModels]
}

export function replaceDefaultModelKey(
  defaultModels: DefaultModels,
  previousModelKey: string,
  nextModelKey: string,
): DefaultModels {
  const next = { ...defaultModels }
  for (const field of DEFAULT_MODEL_FIELDS) {
    if (next[field] === previousModelKey) next[field] = nextModelKey
  }
  return next
}

export function clearMissingDefaultModels(
  defaultModels: DefaultModels,
  remainingModelKeys: ReadonlySet<string>,
): DefaultModels {
  const next = { ...defaultModels }
  for (const field of DEFAULT_MODEL_FIELDS) {
    const current = next[field]
    if (current && !remainingModelKeys.has(current)) {
      next[field] = ''
    }
  }
  return next
}

export function applyMissingCapabilityDefaults(
  capabilityDefaults: CapabilitySelections,
  modelKey: string,
  capabilityFields: ReadonlyArray<CapabilityFieldDefaults> | undefined,
): { capabilityDefaults: CapabilitySelections; changed: boolean } {
  if (!capabilityFields || capabilityFields.length === 0) {
    return { capabilityDefaults, changed: false }
  }

  const current = { ...(capabilityDefaults[modelKey] || {}) }
  let changed = false
  for (const definition of capabilityFields) {
    if (current[definition.field] !== undefined) continue
    const firstOption = definition.options[0]
    if (firstOption === undefined) continue
    current[definition.field] = firstOption
    changed = true
  }

  if (!changed) {
    return { capabilityDefaults, changed: false }
  }

  return {
    capabilityDefaults: {
      ...capabilityDefaults,
      [modelKey]: current,
    },
    changed: true,
  }
}
