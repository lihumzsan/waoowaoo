'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  VideoGenerationOptions,
  VideoModelOption,
  VideoPanel,
  VideoDurationBinding,
} from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video'
import {
  normalizeVideoGenerationSelections,
  resolveEffectiveVideoCapabilityDefinitions,
  resolveEffectiveVideoCapabilityFields,
} from '@/lib/model-capabilities/video-effective'
import { supportsFirstLastFrame } from '@/lib/model-capabilities/video-model-options'
import { projectVideoPricingTiersByFixedSelections } from '@/lib/model-pricing/video-tier'
import { buildFirstLastFrameVideoPrompt } from './first-last-frame-prompt-entry'
import { useFirstLastFramePromptEntries } from './useFirstLastFramePromptEntries'

interface FirstLastFrameCapabilityField {
  field: string
  label: string
  options: VideoGenerationOptionValue[]
  disabledOptions?: VideoGenerationOptionValue[]
  value: VideoGenerationOptionValue | undefined
}

type VideoGenerationOptionValue = string | number | boolean

function parseByOptionType(
  input: string,
  sample: VideoGenerationOptionValue,
): VideoGenerationOptionValue {
  if (typeof sample === 'number') return Number(input)
  if (typeof sample === 'boolean') return input === 'true'
  return input
}

function toFieldLabel(field: string): string {
  return field.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase())
}

interface UseVideoFirstLastFrameFlowParams {
  projectId: string
  episodeId: string
  allPanels: VideoPanel[]
  linkedPanels: Map<string, boolean>
  videoModelOptions: VideoModelOption[]
  onGenerateVideo: (
    storyboardId: string,
    panelIndex: number,
    videoModel?: string,
    firstLastFrame?: {
      lastFrameStoryboardId: string
      lastFramePanelIndex: number
      flModel: string
      customPrompt?: string
      customPromptEditedByUser?: boolean
    },
    generationOptions?: VideoGenerationOptions,
    panelId?: string,
    videoDurationBinding?: VideoDurationBinding,
    customPrompt?: string,
  ) => Promise<void>
  promptTaskStates: {
    getTaskState: (key: string) => {
      phase?: string | null
      lastError?: { message?: string | null } | null
    } | null
  }
  onUpdatePrompt: (
    storyboardId: string,
    panelIndex: number,
    value: string,
    field: 'firstLastFramePrompt',
  ) => Promise<void>
}

export function useVideoFirstLastFrameFlow({
  projectId,
  episodeId,
  allPanels,
  linkedPanels,
  videoModelOptions,
  onGenerateVideo,
  promptTaskStates,
  onUpdatePrompt,
}: UseVideoFirstLastFrameFlowParams) {
  const firstLastFrameModelOptions = useMemo(
    () => videoModelOptions.filter((option) => supportsFirstLastFrame(option)),
    [videoModelOptions],
  )
  const [flModel, setFlModel] = useState(firstLastFrameModelOptions[0]?.value || '')
  const [flGenerationOptions, setFlGenerationOptions] = useState<VideoGenerationOptions>({})

  useEffect(() => {
    if (!flModel && firstLastFrameModelOptions.length > 0) {
      setFlModel(firstLastFrameModelOptions[0].value)
      return
    }
    if (flModel && !firstLastFrameModelOptions.some((option) => option.value === flModel)) {
      setFlModel(firstLastFrameModelOptions[0]?.value || '')
    }
  }, [firstLastFrameModelOptions, flModel])

  const selectedFlModelOption = useMemo(
    () => firstLastFrameModelOptions.find((option) => option.value === flModel),
    [firstLastFrameModelOptions, flModel],
  )
  const flPricingTiers = useMemo(
    () => projectVideoPricingTiersByFixedSelections({
      tiers: selectedFlModelOption?.videoPricingTiers ?? [],
      fixedSelections: {
        generationMode: 'firstlastframe',
      },
    }),
    [selectedFlModelOption?.videoPricingTiers],
  )
  const flCapabilityDefinitions = useMemo(
    () => resolveEffectiveVideoCapabilityDefinitions({
      videoCapabilities: selectedFlModelOption?.capabilities?.video,
      pricingTiers: flPricingTiers,
    }),
    [flPricingTiers, selectedFlModelOption?.capabilities?.video],
  )

  useEffect(() => {
    setFlGenerationOptions((previous) => {
      return normalizeVideoGenerationSelections({
        definitions: flCapabilityDefinitions,
        pricingTiers: flPricingTiers,
        selection: previous,
      })
    })
  }, [flCapabilityDefinitions, flPricingTiers])

  const flEffectiveCapabilityFields = useMemo(
    () => resolveEffectiveVideoCapabilityFields({
      definitions: flCapabilityDefinitions,
      pricingTiers: flPricingTiers,
      selection: flGenerationOptions,
    }),
    [flCapabilityDefinitions, flGenerationOptions, flPricingTiers],
  )
  const flEffectiveFieldMap = useMemo(
    () => new Map(flEffectiveCapabilityFields.map((field) => [field.field, field])),
    [flEffectiveCapabilityFields],
  )
  const flDefinitionFieldMap = useMemo(
    () => new Map(flCapabilityDefinitions.map((definition) => [definition.field, definition])),
    [flCapabilityDefinitions],
  )

  const flCapabilityFields: FirstLastFrameCapabilityField[] = useMemo(() => {
    return flCapabilityDefinitions.map((definition) => {
      const effectiveField = flEffectiveFieldMap.get(definition.field)
      const enabledOptions = effectiveField?.options ?? []
      return {
        field: definition.field,
        label: toFieldLabel(definition.field),
        options: definition.options as VideoGenerationOptionValue[],
        disabledOptions: (definition.options as VideoGenerationOptionValue[])
          .filter((option) => !enabledOptions.includes(option)),
        value: effectiveField?.value as VideoGenerationOptionValue | undefined,
      }
    })
  }, [flCapabilityDefinitions, flEffectiveFieldMap])

  const flMissingCapabilityFields = useMemo(
    () => flEffectiveCapabilityFields
      .filter((field) => field.options.length === 0 || field.value === undefined)
      .map((field) => field.field),
    [flEffectiveCapabilityFields],
  )

  const setFlCapabilityValue = useCallback((field: string, rawValue: string) => {
    const definitionField = flDefinitionFieldMap.get(field)
    if (!definitionField || definitionField.options.length === 0) return
    const parsedValue = parseByOptionType(rawValue, definitionField.options[0])
    if (!definitionField.options.includes(parsedValue)) return
    setFlGenerationOptions((previous) => ({
      ...normalizeVideoGenerationSelections({
        definitions: flCapabilityDefinitions,
        pricingTiers: flPricingTiers,
        selection: {
          ...previous,
          [field]: parsedValue,
        },
        pinnedFields: [field],
      }),
    }))
  }, [flCapabilityDefinitions, flDefinitionFieldMap, flPricingTiers])

  const {
    promptEntries,
    getPromptEntry,
    setPromptValue,
    savePromptValue,
    ensurePrompt,
    unlinkPrompt,
  } = useFirstLastFramePromptEntries({
    projectId,
    episodeId,
    allPanels,
    linkedPanels,
    flModel,
    flGenerationOptions,
    promptTaskStates,
    onUpdatePrompt,
  })

  const handleGenerateFirstLastFrame = useCallback(async (
    firstStoryboardId: string,
    firstPanelIndex: number,
    lastStoryboardId: string,
    lastPanelIndex: number,
    panelKey: string,
    generationOptions?: VideoGenerationOptions,
    firstPanelId?: string,
  ) => {
    const firstPanel = allPanels.find(
      (panel) =>
        panel.storyboardId === firstStoryboardId
        && panel.panelIndex === firstPanelIndex,
    )
    const lastPanel = allPanels.find(
      (panel) =>
        panel.storyboardId === lastStoryboardId
        && panel.panelIndex === lastPanelIndex,
    )
    if (!firstPanel || !lastPanel) return
    const entry = getPromptEntry(panelKey)
    if (!entry) return
    const requestPrompt = buildFirstLastFrameVideoPrompt(entry)
    await onGenerateVideo(firstStoryboardId, firstPanelIndex, flModel, {
      lastFrameStoryboardId: lastStoryboardId,
      lastFramePanelIndex: lastPanelIndex,
      flModel,
      ...requestPrompt,
    }, generationOptions ?? flGenerationOptions, firstPanelId, firstPanel?.videoDurationBinding)
  }, [allPanels, flGenerationOptions, flModel, getPromptEntry, onGenerateVideo])

  const getNextPanel = useCallback((currentIndex: number): VideoPanel | null => {
    if (currentIndex >= allPanels.length - 1) return null
    return allPanels[currentIndex + 1]
  }, [allPanels])

  const isLinkedAsLastFrame = useCallback((currentIndex: number): boolean => {
    if (currentIndex === 0) return false
    const previousPanel = allPanels[currentIndex - 1]
    const previousKey = `${previousPanel.storyboardId}-${previousPanel.panelIndex}`
    return linkedPanels.get(previousKey) || false
  }, [allPanels, linkedPanels])

  return {
    flModel,
    flModelOptions: firstLastFrameModelOptions,
    flGenerationOptions,
    flCapabilityFields,
    flMissingCapabilityFields,
    promptEntries,
    setFlModel,
    setFlCapabilityValue,
    setPromptValue,
    savePromptValue,
    ensurePrompt,
    unlinkPrompt,
    handleGenerateFirstLastFrame,
    getNextPanel,
    isLinkedAsLastFrame,
  }
}
