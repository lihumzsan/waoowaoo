import { useEffect, useMemo, useState } from 'react'
import type { VideoModelOption, VideoGenerationOptionValue, VideoGenerationOptions } from '../../../types'
import type { CapabilitySelections } from '@/lib/model-config-contract'
import {
  normalizeVideoGenerationSelections,
  resolveEffectiveVideoCapabilityDefinitions,
  resolveEffectiveVideoCapabilityFields,
} from '@/lib/model-capabilities/video-effective'
import { projectVideoPricingTiersByFixedSelections } from '@/lib/model-pricing/video-tier'
import { normalizeDefaultVideoModel } from '@/lib/novel-promotion/video-model-defaults'
import { retainEqualJsonState } from './video-state-sync'
import {
  applyRecommendedVideoDurationSelection,
  normalizeRecommendedVideoDuration,
  supportsRecommendedVideoDuration,
  withRecommendedVideoDuration,
} from '@/lib/model-capabilities/video-recommended-duration'

interface UsePanelVideoModelParams {
  defaultVideoModel: string
  capabilityOverrides?: CapabilitySelections
  userVideoModels?: VideoModelOption[]
  recommendedDuration?: unknown
}

interface CapabilityField {
  field: string
  label: string
  labelKey?: string
  unitKey?: string
  optionLabelKeys?: Record<string, string>
  options: VideoGenerationOptionValue[]
  disabledOptions?: VideoGenerationOptionValue[]
  value: VideoGenerationOptionValue | undefined
  recommendedValue?: VideoGenerationOptionValue
}

function toFieldLabel(field: string): string {
  return field.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase())
}

function parseByOptionType(
  input: string,
  sample: VideoGenerationOptionValue,
): VideoGenerationOptionValue {
  if (typeof sample === 'number') return Number(input)
  if (typeof sample === 'boolean') return input === 'true'
  return input
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isGenerationOptionValue(value: unknown): value is VideoGenerationOptionValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function readSelectionForModel(
  capabilityOverrides: CapabilitySelections | undefined,
  modelKey: string,
): VideoGenerationOptions {
  if (!modelKey || !capabilityOverrides) return {}
  const rawSelection = capabilityOverrides[modelKey]
  if (!isRecord(rawSelection)) return {}

  const selection: VideoGenerationOptions = {}
  for (const [field, value] of Object.entries(rawSelection)) {
    if (field === 'aspectRatio') continue
    if (!isGenerationOptionValue(value)) continue
    selection[field] = value
  }
  return selection
}

export function usePanelVideoModel({
  defaultVideoModel,
  capabilityOverrides,
  userVideoModels,
  recommendedDuration,
}: UsePanelVideoModelParams) {
  const normalizedDefaultVideoModel = normalizeDefaultVideoModel(defaultVideoModel || '')
  const [selectedModel, setSelectedModel] = useState(normalizedDefaultVideoModel)
  const [generationOptions, setGenerationOptions] = useState<VideoGenerationOptions>(() =>
    applyRecommendedVideoDurationSelection(
      readSelectionForModel(capabilityOverrides, normalizedDefaultVideoModel),
      { modelKey: normalizedDefaultVideoModel, recommendedDuration },
    ),
  )
  const videoModelOptions = useMemo(() => userVideoModels ?? [], [userVideoModels])
  const selectedOption = videoModelOptions.find((option) => option.value === selectedModel)
  const pricingTiers = useMemo(
    () => projectVideoPricingTiersByFixedSelections({
      tiers: selectedOption?.videoPricingTiers ?? [],
      fixedSelections: {
        generationMode: 'normal',
      },
    }),
    [selectedOption?.videoPricingTiers],
  )

  useEffect(() => {
    setSelectedModel(normalizedDefaultVideoModel)
  }, [normalizedDefaultVideoModel])

  useEffect(() => {
    if (videoModelOptions.length === 0) return
    if (!selectedModel) {
      const nextDefault = videoModelOptions.some((option) => option.value === normalizedDefaultVideoModel)
        ? normalizedDefaultVideoModel
        : videoModelOptions[0].value
      setSelectedModel(nextDefault)
      return
    }
    if (videoModelOptions.some((option) => option.value === selectedModel)) return
    const nextDefault = videoModelOptions.some((option) => option.value === normalizedDefaultVideoModel)
      ? normalizedDefaultVideoModel
      : videoModelOptions[0].value
    setSelectedModel(nextDefault)
  }, [normalizedDefaultVideoModel, selectedModel, videoModelOptions])

  const recommendedDurationSeconds = normalizeRecommendedVideoDuration(recommendedDuration)
  const usesRecommendedDuration = recommendedDurationSeconds !== null
    && supportsRecommendedVideoDuration(selectedModel)
  const capabilityDefinitions = useMemo(
    () => withRecommendedVideoDuration(
      resolveEffectiveVideoCapabilityDefinitions({
        videoCapabilities: selectedOption?.capabilities?.video,
        pricingTiers,
      }),
      { modelKey: selectedModel, recommendedDuration },
    ),
    [pricingTiers, recommendedDuration, selectedModel, selectedOption?.capabilities?.video],
  )

  const selectedModelOverrides = useMemo(
    () => readSelectionForModel(capabilityOverrides, selectedModel),
    [capabilityOverrides, selectedModel],
  )
  const selectedModelOverridesSignature = useMemo(
    () => JSON.stringify(selectedModelOverrides),
    [selectedModelOverrides],
  )

  useEffect(() => {
    setGenerationOptions((previous) => retainEqualJsonState(
      previous,
      normalizeVideoGenerationSelections({
        definitions: capabilityDefinitions,
        pricingTiers,
        selection: applyRecommendedVideoDurationSelection(
          selectedModelOverrides,
          { modelKey: selectedModel, recommendedDuration },
        ),
      }),
    ))
  }, [selectedModel, selectedModelOverridesSignature, capabilityDefinitions, pricingTiers, selectedModelOverrides, recommendedDuration])

  useEffect(() => {
    setGenerationOptions((previous) => retainEqualJsonState(
      previous,
      normalizeVideoGenerationSelections({
        definitions: capabilityDefinitions,
        pricingTiers,
        selection: previous,
      }),
    ))
  }, [capabilityDefinitions, pricingTiers])

  const effectiveFields = useMemo(
    () => resolveEffectiveVideoCapabilityFields({
      definitions: capabilityDefinitions,
      pricingTiers,
      selection: generationOptions,
    }),
    [capabilityDefinitions, generationOptions, pricingTiers],
  )
  const missingCapabilityFields = useMemo(
    () => effectiveFields
      .filter((field) => field.options.length === 0 || field.value === undefined)
      .map((field) => field.field),
    [effectiveFields],
  )
  const effectiveFieldMap = useMemo(
    () => new Map(effectiveFields.map((field) => [field.field, field])),
    [effectiveFields],
  )
  const definitionFieldMap = useMemo(
    () => new Map(capabilityDefinitions.map((definition) => [definition.field, definition])),
    [capabilityDefinitions],
  )
  const capabilityFields: CapabilityField[] = useMemo(() => {
    return capabilityDefinitions.map((definition) => {
      const effectiveField = effectiveFieldMap.get(definition.field)
      const enabledOptions = effectiveField?.options ?? []
      return {
        field: definition.field,
        label: toFieldLabel(definition.field),
        labelKey: definition.fieldI18n?.labelKey,
        unitKey: definition.fieldI18n?.unitKey,
        optionLabelKeys: definition.fieldI18n?.optionLabelKeys,
        options: definition.options as VideoGenerationOptionValue[],
        disabledOptions: (definition.options as VideoGenerationOptionValue[])
          .filter((option) => !enabledOptions.includes(option)),
        value: effectiveField?.value as VideoGenerationOptionValue | undefined,
        recommendedValue: definition.field === 'duration' && usesRecommendedDuration
          ? recommendedDurationSeconds
          : undefined,
      }
    })
  }, [capabilityDefinitions, effectiveFieldMap, recommendedDurationSeconds, usesRecommendedDuration])

  const setCapabilityValue = (field: string, rawValue: string) => {
    const definitionField = definitionFieldMap.get(field)
    if (!definitionField || definitionField.options.length === 0) return
    const parsedValue = parseByOptionType(rawValue, definitionField.options[0])
    if (!definitionField.options.includes(parsedValue)) return
    setGenerationOptions((previous) => ({
      ...normalizeVideoGenerationSelections({
        definitions: capabilityDefinitions,
        pricingTiers,
        selection: {
          ...previous,
          [field]: parsedValue,
        },
        pinnedFields: [field],
      }),
    }))
  }

  return {
    selectedModel,
    setSelectedModel,
    generationOptions,
    selectedVideoCapabilities: selectedOption?.capabilities?.video,
    capabilityFields,
    setCapabilityValue,
    missingCapabilityFields,
    videoModelOptions,
  }
}
