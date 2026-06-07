'use client'

import { useMemo } from 'react'
import type { WorkspaceRuntimeValue, WorkspaceVideoBlockArrangementBlock } from '../WorkspaceRuntimeContext'
import type { CapabilitySelections, ModelCapabilities } from '@/lib/ai-registry/types'
import { VideoPricingTier } from '@/lib/ai-registry/video-capabilities'
import type {
  WorkspaceBatchVideoGenerationParams,
  WorkspaceVideoGenerationOptions,
} from '../video-generation-types'

interface UseWorkspaceRuntimeParams {
  assetsLoading: boolean
  isSubmittingTTS: boolean
  isTransitioning: boolean
  isConfirmingAssets: boolean
  isStartingPlan: boolean
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
  onRequestAssistantPlan: () => Promise<void>
  handleGenerateEditScreenplay: (prompt: string) => Promise<void>
  handleConfirmEditStylePreview: (stylePreviewId: string) => Promise<void>
  handleGenerateEditDirectorDecoupage: (screenplayId?: string) => Promise<void>
  handleGenerateEditScript: (screenplayId?: string) => Promise<void>
  handleRegenerateStoryboardText: (storyboardId: string) => Promise<void>
  handleUpdateClip: (clipId: string, updates: Record<string, unknown>) => Promise<void>
  openAssetLibrary: (characterId?: string | null, refreshAssets?: boolean) => void
  handleGeneratePanelImage: (panelId: string, count?: number) => Promise<void>
  handleSelectPanelCandidate: (panelId: string, imageUrl: string) => Promise<void>
  handleCancelPanelCandidate: (panelId: string) => Promise<void>
  handleGenerateVideo: (
    storyboardId: string,
    panelIndex: number,
    videoModel?: string,
    firstLastFrame?: {
      lastFrameStoryboardId: string
      lastFramePanelIndex: number
      flModel: string
      customPrompt?: string
    },
    generationOptions?: WorkspaceVideoGenerationOptions,
    panelId?: string,
  ) => Promise<void>
  handleGenerateAllVideos: (options?: WorkspaceBatchVideoGenerationParams) => Promise<void>
  handleGenerateBgmScore: () => Promise<void>
  handleRenderFinalVideo: () => Promise<void>
  handleGenerateEditAssets: (editScriptId: string, requirementId?: string) => Promise<void>
  handleGenerateEditCinematographyShotPlan: (editScriptId: string) => Promise<void>
  handleRegenerateProjectAssetImage: (assetId: string, kind: 'character' | 'location') => Promise<void>
  handleGenerateEditStoryboard: (editScriptId: string) => Promise<void>
  handleGenerateEditStoryboardSpatialBlocking: (editScriptId: string) => Promise<void>
  handleUpdateVideoPrompt: (
    storyboardId: string,
    panelIndex: number,
    value: string,
    field?: 'imagePrompt' | 'videoPrompt' | 'firstLastFramePrompt',
  ) => Promise<void>
  handleUpdateVideoPlanPrompt: (editScriptId: string, blockIndex: number, prompt: string) => Promise<void>
  handleArrangeVideoBlocks: (editScriptId: string, blocks: readonly WorkspaceVideoBlockArrangementBlock[]) => Promise<void>
  handleUpdateEditAssetRequirementDescription: (editScriptId: string, requirementId: string, description: string) => Promise<void>
  handleUpdatePanelVideoModel: (storyboardId: string, panelIndex: number, model: string) => Promise<void>
}

export function useWorkspaceRuntime({
  assetsLoading,
  isSubmittingTTS,
  isTransitioning,
  isConfirmingAssets,
  isStartingPlan,
  videoRatio,
  videoModel,
  singleShotVideoModel,
  sequenceVideoModel,
  capabilityOverrides,
  userVideoModels,
  handleUpdateEpisode,
  handleUpdateConfig,
  onRequestAssistantPlan,
  handleGenerateEditScreenplay,
  handleConfirmEditStylePreview,
  handleGenerateEditDirectorDecoupage,
  handleGenerateEditScript,
  handleRegenerateStoryboardText,
  handleUpdateClip,
  openAssetLibrary,
  handleGeneratePanelImage,
  handleSelectPanelCandidate,
  handleCancelPanelCandidate,
  handleGenerateVideo,
  handleGenerateAllVideos,
  handleGenerateBgmScore,
  handleRenderFinalVideo,
  handleGenerateEditAssets,
  handleGenerateEditCinematographyShotPlan,
  handleRegenerateProjectAssetImage,
  handleGenerateEditStoryboard,
  handleGenerateEditStoryboardSpatialBlocking,
  handleUpdateVideoPrompt,
  handleUpdateVideoPlanPrompt,
  handleArrangeVideoBlocks,
  handleUpdateEditAssetRequirementDescription,
  handleUpdatePanelVideoModel,
}: UseWorkspaceRuntimeParams) {
  const resolvedUserVideoModels = useMemo(
    () => userVideoModels || [],
    [userVideoModels],
  )

  return useMemo<WorkspaceRuntimeValue>(() => ({
    assetsLoading,
    isSubmittingTTS,
    isTransitioning,
    isConfirmingAssets,
    isStartingPlan,
    videoRatio,
    videoModel,
    singleShotVideoModel,
    sequenceVideoModel,
    capabilityOverrides,
    userVideoModels: resolvedUserVideoModels,
    onNovelTextChange: (value) => handleUpdateEpisode('novelText', value),
    onVideoRatioChange: (value) => handleUpdateConfig('videoRatio', value),
    onRequestAssistantPlan,
    onGenerateEditScreenplay: handleGenerateEditScreenplay,
    onConfirmEditStylePreview: handleConfirmEditStylePreview,
    onGenerateEditDirectorDecoupage: handleGenerateEditDirectorDecoupage,
    onGenerateEditScript: handleGenerateEditScript,
    onRegenerateStoryboardText: handleRegenerateStoryboardText,
    onClipUpdate: (clipId, data) => {
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('onClipUpdate requires a plain object payload')
      }
      return handleUpdateClip(clipId, data as Record<string, unknown>)
    },
    onOpenAssetLibrary: () => openAssetLibrary(),
    onGeneratePanelImage: handleGeneratePanelImage,
    onSelectPanelCandidate: handleSelectPanelCandidate,
    onCancelPanelCandidate: handleCancelPanelCandidate,
    onGenerateVideo: handleGenerateVideo,
    onGenerateAllVideos: handleGenerateAllVideos,
    onGenerateBgmScore: handleGenerateBgmScore,
    onRenderFinalVideo: handleRenderFinalVideo,
    onGenerateEditAssets: handleGenerateEditAssets,
    onGenerateEditCinematographyShotPlan: handleGenerateEditCinematographyShotPlan,
    onRegenerateProjectAssetImage: handleRegenerateProjectAssetImage,
    onGenerateEditStoryboard: handleGenerateEditStoryboard,
    onGenerateEditStoryboardSpatialBlocking: handleGenerateEditStoryboardSpatialBlocking,
    onUpdateVideoPrompt: handleUpdateVideoPrompt,
    onUpdateVideoPlanPrompt: handleUpdateVideoPlanPrompt,
    onArrangeVideoBlocks: handleArrangeVideoBlocks,
    onUpdateEditAssetRequirementDescription: handleUpdateEditAssetRequirementDescription,
    onUpdatePanelVideoModel: handleUpdatePanelVideoModel,
    onOpenAssetLibraryForCharacter: (characterId, refreshAssets) => openAssetLibrary(characterId, refreshAssets),
  }), [
    assetsLoading,
    handleGenerateAllVideos,
    handleGenerateBgmScore,
    handleRenderFinalVideo,
    handleGenerateEditAssets,
    handleGenerateEditCinematographyShotPlan,
    handleRegenerateProjectAssetImage,
    handleGenerateEditStoryboard,
    handleGenerateEditStoryboardSpatialBlocking,
    handleGeneratePanelImage,
    handleSelectPanelCandidate,
    handleCancelPanelCandidate,
    handleGenerateVideo,
    handleUpdateClip,
    handleUpdateConfig,
    handleUpdateEpisode,
    handleGenerateEditScreenplay,
    handleConfirmEditStylePreview,
    handleGenerateEditDirectorDecoupage,
    handleGenerateEditScript,
    handleRegenerateStoryboardText,
    handleArrangeVideoBlocks,
    handleUpdatePanelVideoModel,
    handleUpdateEditAssetRequirementDescription,
    handleUpdateVideoPlanPrompt,
    handleUpdateVideoPrompt,
    isConfirmingAssets,
    isStartingPlan,
    isSubmittingTTS,
    isTransitioning,
    openAssetLibrary,
    onRequestAssistantPlan,
    resolvedUserVideoModels,
    capabilityOverrides,
    singleShotVideoModel,
    sequenceVideoModel,
    videoModel,
    videoRatio,
  ])
}
