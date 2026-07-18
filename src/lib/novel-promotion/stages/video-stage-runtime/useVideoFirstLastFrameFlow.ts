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
import {
  buildFirstLastFrameVideoPrompt,
  restoreFirstLastFrameSmartDurationBinding,
  resolveFirstLastFrameDurationStatus,
  resolveFirstLastFrameDurationSelection,
  resolvePanelFirstLastFrameGenerationOptions,
  shouldEnsurePromptAfterDurationSelection,
  type FirstLastFrameDurationStatus,
} from './first-last-frame-prompt-entry'
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
  visiblePanelKeys?: ReadonlySet<string>
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
    isFetching: boolean
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
  onUpdatePanelVideoDurationBinding: (
    storyboardId: string,
    panelIndex: number,
    binding: VideoDurationBinding,
  ) => Promise<void>
}

export function useVideoFirstLastFrameFlow({
  projectId,
  episodeId,
  allPanels,
  linkedPanels,
  visiblePanelKeys,
  videoModelOptions,
  onGenerateVideo,
  promptTaskStates,
  onUpdatePrompt,
  onUpdatePanelVideoDurationBinding,
}: UseVideoFirstLastFrameFlowParams) {
  const firstLastFrameModelOptions = useMemo(
    () => videoModelOptions.filter((option) => supportsFirstLastFrame(option)),
    [videoModelOptions],
  )
  const [flModel, setFlModel] = useState(firstLastFrameModelOptions[0]?.value || '')
  const [flGenerationOptions, setFlGenerationOptions] = useState<VideoGenerationOptions>({})
  const [flGenerationOptionsByPanel, setFlGenerationOptionsByPanel] = useState<Map<string, VideoGenerationOptions>>(new Map())

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

  const normalizeFlCapabilityValue = useCallback((
    field: string,
    rawValue: string,
    selection: VideoGenerationOptions,
  ) => {
    const definitionField = flDefinitionFieldMap.get(field)
    if (!definitionField || definitionField.options.length === 0) return null
    const parsedValue = parseByOptionType(rawValue, definitionField.options[0])
    if (!definitionField.options.includes(parsedValue)) return null
    return normalizeVideoGenerationSelections({
      definitions: flCapabilityDefinitions,
      pricingTiers: flPricingTiers,
      selection: { ...selection, [field]: parsedValue },
      pinnedFields: [field],
    })
  }, [flCapabilityDefinitions, flDefinitionFieldMap, flPricingTiers])

  const {
    promptEntries,
    getPromptEntry,
    setPromptValue,
    savePromptValue,
    ensurePrompt,
    unlinkPrompt,
    beginDurationPersistence,
    confirmPersistedDuration,
    failDurationPersistence,
    getPersistedDurationOverride,
  } = useFirstLastFramePromptEntries({
    projectId,
    episodeId,
    allPanels,
    linkedPanels,
    visiblePanelKeys,
    promptTaskStates,
    onUpdatePrompt,
  })

  const setFlCapabilityValue = useCallback(async (
    panelKey: string,
    field: string,
    rawValue: string,
  ) => {
    const currentOptions = resolvePanelFirstLastFrameGenerationOptions(
      panelKey,
      flGenerationOptions,
      flGenerationOptionsByPanel,
      getPersistedDurationOverride(panelKey)
        || allPanels.find((panel) => `${panel.storyboardId}-${panel.panelIndex}` === panelKey)
          ?.videoDurationBinding,
    )
    const nextOptions = normalizeFlCapabilityValue(field, rawValue, currentOptions)
    if (!nextOptions) return
    const firstPanel = allPanels.find(
      (panel) => `${panel.storyboardId}-${panel.panelIndex}` === panelKey,
    )
    const currentBinding = getPersistedDurationOverride(panelKey) || firstPanel?.videoDurationBinding
    const durationSelection = resolveFirstLastFrameDurationSelection(field, rawValue, nextOptions, currentBinding)
    if (!durationSelection) {
      setFlGenerationOptions(nextOptions)
      return
    }
    if (!firstPanel) return
    beginDurationPersistence(panelKey)
    try {
      await onUpdatePanelVideoDurationBinding(
        firstPanel.storyboardId,
        firstPanel.panelIndex,
        durationSelection.binding,
      )
      setFlGenerationOptionsByPanel((previous) => new Map(previous).set(
        panelKey,
        durationSelection.generationOptions,
      ))
      confirmPersistedDuration(panelKey, durationSelection.binding)
      if (shouldEnsurePromptAfterDurationSelection({
        previousBinding: currentBinding,
        nextBinding: durationSelection.binding,
      })) {
        await ensurePrompt(panelKey, 'source_change')
      }
    } catch (error) {
      failDurationPersistence(panelKey, error)
    }
  }, [allPanels, beginDurationPersistence, confirmPersistedDuration, ensurePrompt, failDurationPersistence, flGenerationOptions, flGenerationOptionsByPanel, getPersistedDurationOverride, normalizeFlCapabilityValue, onUpdatePanelVideoDurationBinding])

  const restoreSmartDuration = useCallback(async (panelKey: string) => {
    const firstPanel = allPanels.find(
      (panel) => `${panel.storyboardId}-${panel.panelIndex}` === panelKey,
    )
    if (!firstPanel) return
    const currentBinding = getPersistedDurationOverride(panelKey) || firstPanel.videoDurationBinding
    const nextBinding = restoreFirstLastFrameSmartDurationBinding(currentBinding)
    if (!nextBinding || typeof nextBinding.targetDurationSeconds !== 'number') return
    const targetDurationSeconds = nextBinding.targetDurationSeconds
    beginDurationPersistence(panelKey)
    try {
      await onUpdatePanelVideoDurationBinding(
        firstPanel.storyboardId,
        firstPanel.panelIndex,
        nextBinding,
      )
      setFlGenerationOptionsByPanel((previous) => new Map(previous).set(panelKey, {
        ...resolvePanelFirstLastFrameGenerationOptions(
          panelKey,
          flGenerationOptions,
          previous,
          nextBinding,
        ),
        duration: targetDurationSeconds,
      }))
      confirmPersistedDuration(panelKey, nextBinding)
      if (shouldEnsurePromptAfterDurationSelection({
        previousBinding: currentBinding,
        nextBinding,
      })) {
        await ensurePrompt(panelKey, 'source_change')
      }
    } catch (error) {
      failDurationPersistence(panelKey, error)
    }
  }, [
    allPanels,
    beginDurationPersistence,
    confirmPersistedDuration,
    ensurePrompt,
    failDurationPersistence,
    flGenerationOptions,
    getPersistedDurationOverride,
    onUpdatePanelVideoDurationBinding,
  ])

  const getFirstLastFrameDurationStatus = useCallback((panelKey: string): FirstLastFrameDurationStatus | null => {
    const firstPanel = allPanels.find(
      (panel) => `${panel.storyboardId}-${panel.panelIndex}` === panelKey,
    )
    if (!firstPanel) return null
    const binding = getPersistedDurationOverride(panelKey) || firstPanel.videoDurationBinding
    const options = resolvePanelFirstLastFrameGenerationOptions(
      panelKey,
      flGenerationOptions,
      flGenerationOptionsByPanel,
      binding,
    )
    return resolveFirstLastFrameDurationStatus({
      binding,
      durationSeconds: options.duration,
      promptStatus: getPromptEntry(panelKey)?.status,
    })
  }, [
    allPanels,
    flGenerationOptions,
    flGenerationOptionsByPanel,
    getPersistedDurationOverride,
    getPromptEntry,
  ])

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
    }, generationOptions ?? resolvePanelFirstLastFrameGenerationOptions(
      panelKey,
      flGenerationOptions,
      flGenerationOptionsByPanel,
      firstPanel.videoDurationBinding?.targetDurationSeconds,
    ), firstPanelId, getPersistedDurationOverride(panelKey) || firstPanel?.videoDurationBinding)
  }, [allPanels, flGenerationOptions, flGenerationOptionsByPanel, flModel, getPersistedDurationOverride, getPromptEntry, onGenerateVideo])

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
    flGenerationOptionsByPanel,
    flCapabilityFields,
    flMissingCapabilityFields,
    promptEntries,
    setFlModel,
    setFlCapabilityValue,
    restoreSmartDuration,
    getFirstLastFrameDurationStatus,
    setPromptValue,
    savePromptValue,
    ensurePrompt,
    unlinkPrompt,
    handleGenerateFirstLastFrame,
    getNextPanel,
    isLinkedAsLastFrame,
  }
}
