'use client'

import { useMemo } from 'react'
import type {
  WorkspaceEditBibleGenerationInput,
  WorkspaceRuntimeValue,
} from '../WorkspaceRuntimeContext'
import type { CapabilitySelections, ModelCapabilities } from '@/lib/ai-registry/types'
import { VideoPricingTier } from '@/lib/ai-registry/video-capabilities'
import type {
  WorkspaceBatchVideoGenerationParams,
  WorkspaceVideoGenerationOptions,
} from '../video-generation-types'

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
  handleGeneratePanelImage: (panelId: string, count?: number) => Promise<void>
  handleGenerateVideo: (
    storyboardId: string,
    panelIndex: number,
    generationOptions?: WorkspaceVideoGenerationOptions,
    panelId?: string,
  ) => Promise<void>
  handleGenerateAllVideos: (options?: WorkspaceBatchVideoGenerationParams) => Promise<void>
  handleGenerateBgmScore: () => Promise<void>
  handlePlanSoundscape: () => Promise<void>
  handleGenerateSoundscape: () => Promise<void>
  handleRenderFinalVideo: () => Promise<void>
  handleGenerateEditAssets: (editScriptId: string, requirementId?: string) => Promise<void>
  handleGenerateEditShotExecutionPlan: (editScriptId: string) => Promise<void>
  handleRegenerateProjectAssetImage: (assetId: string, kind: 'character' | 'location') => Promise<void>
  handleGenerateEditStoryboard: (editScriptId: string) => Promise<void>
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
  handleGeneratePanelImage,
  handleGenerateVideo,
  handleGenerateAllVideos,
  handleGenerateBgmScore,
  handlePlanSoundscape,
  handleGenerateSoundscape,
  handleRenderFinalVideo,
  handleGenerateEditAssets,
  handleGenerateEditShotExecutionPlan,
  handleRegenerateProjectAssetImage,
  handleGenerateEditStoryboard,
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
    onGeneratePanelImage: handleGeneratePanelImage,
    onGenerateVideo: handleGenerateVideo,
    onGenerateAllVideos: handleGenerateAllVideos,
    onGenerateBgmScore: handleGenerateBgmScore,
    onPlanSoundscape: handlePlanSoundscape,
    onGenerateSoundscape: handleGenerateSoundscape,
    onRenderFinalVideo: handleRenderFinalVideo,
    onGenerateEditAssets: handleGenerateEditAssets,
    onGenerateEditShotExecutionPlan: handleGenerateEditShotExecutionPlan,
    onRegenerateProjectAssetImage: handleRegenerateProjectAssetImage,
    onGenerateEditStoryboard: handleGenerateEditStoryboard,
    onUpdateVideoPrompt: handleUpdateVideoPrompt,
    onUpdateEditAssetRequirementDescription: handleUpdateEditAssetRequirementDescription,
    onUpdatePanelVideoModel: handleUpdatePanelVideoModel,
    onOpenAssetLibraryForCharacter: (characterId, refreshAssets) => openAssetLibrary(characterId, refreshAssets),
  }), [
    assetsLoading,
    handleGenerateAllVideos,
    handleGenerateBgmScore,
    handlePlanSoundscape,
    handleGenerateSoundscape,
    handleRenderFinalVideo,
    handleGenerateEditAssets,
    handleGenerateEditShotExecutionPlan,
    handleRegenerateProjectAssetImage,
    handleGenerateEditStoryboard,
    handleGeneratePanelImage,
    handleGenerateVideo,
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
