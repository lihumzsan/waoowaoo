'use client'

import { useMemo } from 'react'
import type { WorkspaceRuntimeValue, WorkspaceVideoBlockArrangementBlock } from '../WorkspaceRuntimeContext'
import type { CapabilitySelections, ModelCapabilities } from '@/lib/ai-registry/types'
import { VideoPricingTier } from '@/lib/ai-registry/video-capabilities'
import type { BatchVideoGenerationParams, VideoGenerationOptions } from '../components/video'

interface UseWorkspaceRuntimeParams {
  assetsLoading: boolean
  isSubmittingTTS: boolean
  isTransitioning: boolean
  isConfirmingAssets: boolean
  isStartingPlan: boolean
  videoRatio: string | undefined
  artStyle: string | undefined
  visualStylePresetSource: string | undefined
  visualStylePresetId: string | undefined
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
    generationOptions?: VideoGenerationOptions,
    panelId?: string,
  ) => Promise<void>
  handleGenerateAllVideos: (options?: BatchVideoGenerationParams) => Promise<void>
  handleGenerateBgmScore: () => Promise<void>
  handleRenderFinalVideo: () => Promise<void>
  handleGenerateEditAssets: (editScriptId: string, requirementId?: string) => Promise<void>
  handleRegenerateProjectAssetImage: (assetId: string, kind: 'character' | 'location') => Promise<void>
  handleGenerateEditStoryboard: (editScriptId: string) => Promise<void>
  handleGenerateEditStoryboardCoordinates: (editScriptId: string) => Promise<void>
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
  artStyle,
  visualStylePresetSource,
  visualStylePresetId,
  videoModel,
  singleShotVideoModel,
  sequenceVideoModel,
  capabilityOverrides,
  userVideoModels,
  handleUpdateEpisode,
  handleUpdateConfig,
  onRequestAssistantPlan,
  handleGenerateEditScreenplay,
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
  handleRegenerateProjectAssetImage,
  handleGenerateEditStoryboard,
  handleGenerateEditStoryboardCoordinates,
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
    artStyle,
    visualStylePresetSource,
    visualStylePresetId,
    videoModel,
    singleShotVideoModel,
    sequenceVideoModel,
    capabilityOverrides,
    userVideoModels: resolvedUserVideoModels,
    onNovelTextChange: (value) => handleUpdateEpisode('novelText', value),
    onVideoRatioChange: (value) => handleUpdateConfig('videoRatio', value),
    onArtStyleChange: (value) => handleUpdateConfig('artStyle', value),
    onVisualStylePresetChange: (value) => handleUpdateConfig('visualStylePreset', value),
    onRequestAssistantPlan,
    onGenerateEditScreenplay: handleGenerateEditScreenplay,
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
    onRegenerateProjectAssetImage: handleRegenerateProjectAssetImage,
    onGenerateEditStoryboard: handleGenerateEditStoryboard,
    onGenerateEditStoryboardCoordinates: handleGenerateEditStoryboardCoordinates,
    onUpdateVideoPrompt: handleUpdateVideoPrompt,
    onUpdateVideoPlanPrompt: handleUpdateVideoPlanPrompt,
    onArrangeVideoBlocks: handleArrangeVideoBlocks,
    onUpdateEditAssetRequirementDescription: handleUpdateEditAssetRequirementDescription,
    onUpdatePanelVideoModel: handleUpdatePanelVideoModel,
    onOpenAssetLibraryForCharacter: (characterId, refreshAssets) => openAssetLibrary(characterId, refreshAssets),
  }), [
    artStyle,
    visualStylePresetSource,
    visualStylePresetId,
    assetsLoading,
    handleGenerateAllVideos,
    handleGenerateBgmScore,
    handleRenderFinalVideo,
    handleGenerateEditAssets,
    handleRegenerateProjectAssetImage,
    handleGenerateEditStoryboard,
    handleGenerateEditStoryboardCoordinates,
    handleGeneratePanelImage,
    handleSelectPanelCandidate,
    handleCancelPanelCandidate,
    handleGenerateVideo,
    handleUpdateClip,
    handleUpdateConfig,
    handleUpdateEpisode,
    handleGenerateEditScreenplay,
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
