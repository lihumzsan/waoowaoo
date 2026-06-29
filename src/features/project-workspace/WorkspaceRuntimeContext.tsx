'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { CapabilitySelections, ModelCapabilities } from '@/lib/ai-registry/types'
import { VideoPricingTier } from '@/lib/ai-registry/video-capabilities'
import type { EditFirstDurationTier } from '@/lib/edit-script/duration-tier'
import type { EditScriptVideoRatio } from '@/lib/edit-script/types'
import type { StoryboardPanelImageGenerationMode } from '@/lib/storyboard/grid-image-groups'
import type {
  WorkspaceBatchVideoGenerationParams,
  WorkspaceVideoGenerationOptions,
} from './video-generation-types'

export interface WorkspaceVideoModelOption {
  value: string
  label: string
  provider?: string
  providerName?: string
  capabilities?: ModelCapabilities
  videoPricingTiers?: VideoPricingTier[]
}

export interface WorkspaceGenerationSegmentArrangementItem {
  readonly shotNumbers: readonly number[]
  readonly continuity: string
}

export interface WorkspaceEditScreenplayGenerationInput {
  readonly prompt: string
  readonly durationTier: EditFirstDurationTier
  readonly aspectRatio: EditScriptVideoRatio
}

export interface WorkspaceRuntimeValue {
  assetsLoading: boolean
  isTransitioning: boolean
  isConfirmingAssets: boolean
  isAssistantWorkflowStarting: boolean
  videoRatio: string | null | undefined
  videoModel: string | null | undefined
  singleShotVideoModel: string | null | undefined
  sequenceVideoModel: string | null | undefined
  capabilityOverrides: CapabilitySelections
  userVideoModels: WorkspaceVideoModelOption[]
  onNovelTextChange: (value: string) => Promise<void>
  onVideoRatioChange: (value: string) => Promise<void>
  onRequestAssistantGuidance: () => Promise<void>
  onGenerateEditScreenplay: (input: WorkspaceEditScreenplayGenerationInput) => Promise<void>
  onGenerateEditScript: (screenplayId?: string) => Promise<void>
  onOpenAssetLibrary: () => void
  onGeneratePanelImage: (panelId: string, count?: number) => Promise<void>
  onGenerateStoryboardGridImages: (payload: {
    readonly episodeId: string
    readonly editScriptId: string
    readonly sourceGenerationSegmentId: string
    readonly panelIds: readonly string[]
    readonly generationMode?: StoryboardPanelImageGenerationMode
  }) => Promise<void>
  onSelectPanelCandidate: (panelId: string, imageUrl: string) => Promise<void>
  onCancelPanelCandidate: (panelId: string) => Promise<void>
  onGenerateVideo: (
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
  onGenerateAllVideos: (options?: WorkspaceBatchVideoGenerationParams) => Promise<void>
  onGenerateBgmScore: () => Promise<void>
  onRenderFinalVideo: () => Promise<void>
  onGenerateEditAssets: (editScriptId: string, requirementId?: string) => Promise<void>
  onGenerateEditShotExecutionPlan: (editScriptId: string) => Promise<void>
  onRegenerateProjectAssetImage: (assetId: string, kind: 'character' | 'location') => Promise<void>
  onGenerateEditStoryboard: (editScriptId: string) => Promise<void>
  onComposeEditImagePrompts: (editScriptId: string) => Promise<void>
  onComposeEditVideoPrompts: (editScriptId: string) => Promise<void>
  onUpdateVideoPrompt: (
    storyboardId: string,
    panelIndex: number,
    value: string,
    field?: 'imagePrompt' | 'videoPrompt' | 'firstLastFramePrompt',
  ) => Promise<void>
  onUpdateGenerationSegmentContinuity: (editScriptId: string, segmentIndex: number, continuity: string) => Promise<void>
  onArrangeGenerationSegments: (editScriptId: string, segments: readonly WorkspaceGenerationSegmentArrangementItem[]) => Promise<void>
  onUpdateEditAssetRequirementDescription: (editScriptId: string, requirementId: string, description: string) => Promise<void>
  onUpdatePanelVideoModel: (storyboardId: string, panelIndex: number, model: string) => Promise<void>
  onOpenAssetLibraryForCharacter: (characterId?: string | null, refreshAssets?: boolean) => void
}

const WorkspaceRuntimeContext = createContext<WorkspaceRuntimeValue | null>(null)

interface WorkspaceRuntimeProviderProps {
  value: WorkspaceRuntimeValue
  children: ReactNode
}

export function WorkspaceRuntimeProvider({ value, children }: WorkspaceRuntimeProviderProps) {
  return (
    <WorkspaceRuntimeContext.Provider value={value}>
      {children}
    </WorkspaceRuntimeContext.Provider>
  )
}

export function useWorkspaceRuntime() {
  const context = useContext(WorkspaceRuntimeContext)
  if (!context) {
    throw new Error('useWorkspaceRuntime must be used within WorkspaceRuntimeProvider')
  }
  return context
}
