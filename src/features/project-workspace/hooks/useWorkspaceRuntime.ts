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
  openAssetLibrary: (characterId?: string | null) => void
  handlePlanBgmScore: () => Promise<void>
  handleRenderFinalVideo: () => Promise<void>
  handleGenerateEditShotExecutionPlan: (editScriptId: string) => Promise<void>
  handleUpdateEditAssetRequirementDescription: (editScriptId: string, requirementId: string, description: string) => Promise<void>
}

export function useWorkspaceRuntime({
  assetsLoading,
  isTransitioning,
  isConfirmingAssets,
  isAssistantWorkflowStarting,
  videoRatio,
  videoModel,
  capabilityOverrides,
  userVideoModels,
  handleUpdateEpisode,
  handleUpdateConfig,
  onRequestAssistantGuidance,
  handleGenerateEditBible,
  handleGenerateEditScript,
  openAssetLibrary,
  handlePlanBgmScore,
  handleRenderFinalVideo,
  handleGenerateEditShotExecutionPlan,
  handleUpdateEditAssetRequirementDescription,
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
    capabilityOverrides,
    userVideoModels: resolvedUserVideoModels,
    onNovelTextChange: (value) => handleUpdateEpisode('novelText', value),
    onVideoRatioChange: (value) => handleUpdateConfig('videoRatio', value),
    onRequestAssistantGuidance,
    onGenerateEditBible: handleGenerateEditBible,
    onGenerateEditScript: handleGenerateEditScript,
    onOpenAssetLibrary: () => openAssetLibrary(),
    onPlanBgmScore: handlePlanBgmScore,
    onRenderFinalVideo: handleRenderFinalVideo,
    onGenerateEditShotExecutionPlan: handleGenerateEditShotExecutionPlan,
    onUpdateEditAssetRequirementDescription: handleUpdateEditAssetRequirementDescription,
    onOpenAssetLibraryForCharacter: (characterId) => openAssetLibrary(characterId),
  }), [
    assetsLoading,
    handlePlanBgmScore,
    handleRenderFinalVideo,
    handleGenerateEditShotExecutionPlan,
    handleUpdateConfig,
    handleUpdateEpisode,
    handleGenerateEditBible,
    handleGenerateEditScript,
    handleUpdateEditAssetRequirementDescription,
    isConfirmingAssets,
    isAssistantWorkflowStarting,
    isTransitioning,
    openAssetLibrary,
    onRequestAssistantGuidance,
    resolvedUserVideoModels,
    capabilityOverrides,
    videoModel,
    videoRatio,
  ])
}
