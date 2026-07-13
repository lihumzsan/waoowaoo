'use client'

import { useMemo } from 'react'
import type {
  WorkspaceEditBibleGenerationInput,
  WorkspaceRuntimeValue,
} from '../WorkspaceRuntimeContext'
import type { CapabilitySelections, ModelCapabilities } from '@/lib/ai-registry/types'
import { VideoPricingTier } from '@/lib/ai-registry/video-capabilities'

interface UseWorkspaceRuntimeParams {
  assetsLoading: boolean
  isTransitioning: boolean
  isConfirmingAssets: boolean
  isAssistantWorkflowStarting: boolean
  videoRatio: string | undefined
  videoModel: string | undefined
  singleShotVideoModel: string | undefined
  sequenceVideoModel: string | undefined
  capabilityOverrides: CapabilitySelections
  userVideoModels: Array<{
    value: string
    label: string
    provider?: string
    providerName?: string
    capabilities?: ModelCapabilities
    videoPricingTiers?: VideoPricingTier[]
  }> | undefined
  handleUpdateEpisode: (key: string, value: unknown) => Promise<void>
  handleUpdateConfig: (key: string, value: unknown) => Promise<void>
  onRequestAssistantGuidance: () => Promise<void>
  handleGenerateEditBible: (input: WorkspaceEditBibleGenerationInput) => Promise<void>
  handleGenerateEditScript: () => Promise<void>
  openAssetLibrary: (characterId?: string | null, refreshAssets?: boolean) => void
  handlePlanSoundscape: () => Promise<void>
  handleRenderFinalVideo: () => Promise<void>
  handleGenerateEditShotExecutionPlan: (editScriptId: string) => Promise<void>
  handleUpdateVideoPrompt: (
    storyboardId: string,
    panelIndex: number,
    value: string,
    field?: 'imagePrompt' | 'videoPrompt',
  ) => Promise<void>
  handleUpdateEditAssetRequirementDescription: (editScriptId: string, requirementId: string, description: string) => Promise<void>
  handleUpdatePanelVideoModel: (storyboardId: string, panelIndex: number, model: string) => Promise<void>
}

export function useWorkspaceRuntime({
  assetsLoading,
  isTransitioning,
  isConfirmingAssets,
  isAssistantWorkflowStarting,
  videoRatio,
  videoModel,
  singleShotVideoModel,
  sequenceVideoModel,
  capabilityOverrides,
  userVideoModels,
  handleUpdateEpisode,
  handleUpdateConfig,
  onRequestAssistantGuidance,
  handleGenerateEditBible,
  handleGenerateEditScript,
  openAssetLibrary,
  handlePlanSoundscape,
  handleRenderFinalVideo,
  handleGenerateEditShotExecutionPlan,
  handleUpdateVideoPrompt,
  handleUpdateEditAssetRequirementDescription,
  handleUpdatePanelVideoModel,
}: UseWorkspaceRuntimeParams) {
  const resolvedUserVideoModels = useMemo(
    () => userVideoModels || [],
    [userVideoModels],
  )

  return useMemo<WorkspaceRuntimeValue>(() => ({
    assetsLoading,
    isTransitioning,
    isConfirmingAssets,
    isAssistantWorkflowStarting,
    videoRatio,
    videoModel,
    singleShotVideoModel,
    sequenceVideoModel,
    capabilityOverrides,
    userVideoModels: resolvedUserVideoModels,
    onNovelTextChange: (value) => handleUpdateEpisode('novelText', value),
    onVideoRatioChange: (value) => handleUpdateConfig('videoRatio', value),
    onRequestAssistantGuidance,
    onGenerateEditBible: handleGenerateEditBible,
    onGenerateEditScript: handleGenerateEditScript,
    onOpenAssetLibrary: () => openAssetLibrary(),
    onPlanSoundscape: handlePlanSoundscape,
    onRenderFinalVideo: handleRenderFinalVideo,
    onGenerateEditShotExecutionPlan: handleGenerateEditShotExecutionPlan,
    onUpdateVideoPrompt: handleUpdateVideoPrompt,
    onUpdateEditAssetRequirementDescription: handleUpdateEditAssetRequirementDescription,
    onUpdatePanelVideoModel: handleUpdatePanelVideoModel,
    onOpenAssetLibraryForCharacter: (characterId, refreshAssets) => openAssetLibrary(characterId, refreshAssets),
  }), [
    assetsLoading,
    handlePlanSoundscape,
    handleRenderFinalVideo,
    handleGenerateEditShotExecutionPlan,
    handleUpdateConfig,
    handleUpdateEpisode,
    handleGenerateEditBible,
    handleGenerateEditScript,
    handleUpdatePanelVideoModel,
    handleUpdateEditAssetRequirementDescription,
    handleUpdateVideoPrompt,
    isConfirmingAssets,
    isAssistantWorkflowStarting,
    isTransitioning,
    openAssetLibrary,
    onRequestAssistantGuidance,
    resolvedUserVideoModels,
    capabilityOverrides,
    singleShotVideoModel,
    sequenceVideoModel,
    videoModel,
    videoRatio,
  ])
}
