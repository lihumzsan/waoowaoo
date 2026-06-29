'use client'

import { useMemo } from 'react'
import type {
  WorkspaceEditScreenplayGenerationInput,
  WorkspaceGenerationSegmentArrangementItem,
  WorkspaceRuntimeValue,
} from '../WorkspaceRuntimeContext'
import type { CapabilitySelections, ModelCapabilities } from '@/lib/ai-registry/types'
import { VideoPricingTier } from '@/lib/ai-registry/video-capabilities'
import type {
  WorkspaceBatchVideoGenerationParams,
  WorkspaceVideoGenerationOptions,
} from '../video-generation-types'
import type { StoryboardPanelImageGenerationMode } from '@/lib/storyboard/grid-image-groups'

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
  handleGenerateEditScreenplay: (input: WorkspaceEditScreenplayGenerationInput) => Promise<void>
  handleGenerateEditScript: (screenplayId?: string) => Promise<void>
  openAssetLibrary: (characterId?: string | null, refreshAssets?: boolean) => void
  handleGeneratePanelImage: (panelId: string, count?: number) => Promise<void>
  handleGenerateStoryboardGridImages: (payload: {
    readonly episodeId: string
    readonly editScriptId: string
    readonly sourceGenerationSegmentId: string
    readonly panelIds: readonly string[]
    readonly generationMode?: StoryboardPanelImageGenerationMode
  }) => Promise<void>
  handleSelectPanelCandidate: (panelId: string, imageUrl: string) => Promise<void>
  handleCancelPanelCandidate: (panelId: string) => Promise<void>
  handleGenerateVideo: (
    storyboardId: string,
    panelIndex: number,
    firstLastFrame?: {
      lastFrameStoryboardId: string
      lastFramePanelIndex: number
      customPrompt?: string
    },
    generationOptions?: WorkspaceVideoGenerationOptions,
    panelId?: string,
  ) => Promise<void>
  handleGenerateAllVideos: (options?: WorkspaceBatchVideoGenerationParams) => Promise<void>
  handleGenerateBgmScore: () => Promise<void>
  handleRenderFinalVideo: () => Promise<void>
  handleGenerateEditAssets: (editScriptId: string, requirementId?: string) => Promise<void>
  handleGenerateEditShotExecutionPlan: (editScriptId: string) => Promise<void>
  handleRegenerateProjectAssetImage: (assetId: string, kind: 'character' | 'location') => Promise<void>
  handleGenerateEditStoryboard: (editScriptId: string) => Promise<void>
  handleComposeEditImagePrompts: (editScriptId: string) => Promise<void>
  handleComposeEditVideoPrompts: (editScriptId: string) => Promise<void>
  handleUpdateVideoPrompt: (
    storyboardId: string,
    panelIndex: number,
    value: string,
    field?: 'imagePrompt' | 'videoPrompt' | 'firstLastFramePrompt',
  ) => Promise<void>
  handleUpdateGenerationSegmentContinuity: (editScriptId: string, segmentIndex: number, continuity: string) => Promise<void>
  handleArrangeGenerationSegments: (editScriptId: string, segments: readonly WorkspaceGenerationSegmentArrangementItem[]) => Promise<void>
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
  handleGenerateEditScreenplay,
  handleGenerateEditScript,
  openAssetLibrary,
  handleGeneratePanelImage,
  handleGenerateStoryboardGridImages,
  handleSelectPanelCandidate,
  handleCancelPanelCandidate,
  handleGenerateVideo,
  handleGenerateAllVideos,
  handleGenerateBgmScore,
  handleRenderFinalVideo,
  handleGenerateEditAssets,
  handleGenerateEditShotExecutionPlan,
  handleRegenerateProjectAssetImage,
  handleGenerateEditStoryboard,
  handleComposeEditImagePrompts,
  handleComposeEditVideoPrompts,
  handleUpdateVideoPrompt,
  handleUpdateGenerationSegmentContinuity,
  handleArrangeGenerationSegments,
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
    onGenerateEditScreenplay: handleGenerateEditScreenplay,
    onGenerateEditScript: handleGenerateEditScript,
    onOpenAssetLibrary: () => openAssetLibrary(),
    onGeneratePanelImage: handleGeneratePanelImage,
    onGenerateStoryboardGridImages: handleGenerateStoryboardGridImages,
    onSelectPanelCandidate: handleSelectPanelCandidate,
    onCancelPanelCandidate: handleCancelPanelCandidate,
    onGenerateVideo: handleGenerateVideo,
    onGenerateAllVideos: handleGenerateAllVideos,
    onGenerateBgmScore: handleGenerateBgmScore,
    onRenderFinalVideo: handleRenderFinalVideo,
    onGenerateEditAssets: handleGenerateEditAssets,
    onGenerateEditShotExecutionPlan: handleGenerateEditShotExecutionPlan,
    onRegenerateProjectAssetImage: handleRegenerateProjectAssetImage,
    onGenerateEditStoryboard: handleGenerateEditStoryboard,
    onComposeEditImagePrompts: handleComposeEditImagePrompts,
    onComposeEditVideoPrompts: handleComposeEditVideoPrompts,
    onUpdateVideoPrompt: handleUpdateVideoPrompt,
    onUpdateGenerationSegmentContinuity: handleUpdateGenerationSegmentContinuity,
    onArrangeGenerationSegments: handleArrangeGenerationSegments,
    onUpdateEditAssetRequirementDescription: handleUpdateEditAssetRequirementDescription,
    onUpdatePanelVideoModel: handleUpdatePanelVideoModel,
    onOpenAssetLibraryForCharacter: (characterId, refreshAssets) => openAssetLibrary(characterId, refreshAssets),
  }), [
    assetsLoading,
    handleGenerateAllVideos,
    handleGenerateBgmScore,
    handleRenderFinalVideo,
    handleGenerateEditAssets,
    handleGenerateEditShotExecutionPlan,
    handleRegenerateProjectAssetImage,
    handleGenerateEditStoryboard,
    handleComposeEditImagePrompts,
    handleComposeEditVideoPrompts,
    handleGeneratePanelImage,
    handleGenerateStoryboardGridImages,
    handleSelectPanelCandidate,
    handleCancelPanelCandidate,
    handleGenerateVideo,
    handleUpdateConfig,
    handleUpdateEpisode,
    handleGenerateEditScreenplay,
    handleGenerateEditScript,
    handleArrangeGenerationSegments,
    handleUpdatePanelVideoModel,
    handleUpdateEditAssetRequirementDescription,
    handleUpdateGenerationSegmentContinuity,
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
