'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { CapabilitySelections, ModelCapabilities } from '@/lib/ai-registry/types'
import { VideoPricingTier } from '@/lib/ai-registry/video-capabilities'
import type { BatchVideoGenerationParams, VideoGenerationOptions } from './components/video'

export interface WorkspaceVideoModelOption {
  value: string
  label: string
  provider?: string
  providerName?: string
  capabilities?: ModelCapabilities
  videoPricingTiers?: VideoPricingTier[]
}

export interface WorkspaceVideoBlockArrangementBlock {
  readonly shotNumbers: readonly number[]
}

export interface WorkspaceRuntimeValue {
  assetsLoading: boolean
  isSubmittingTTS: boolean
  isTransitioning: boolean
  isConfirmingAssets: boolean
  isStartingPlan: boolean
  videoRatio: string | null | undefined
  artStyle: string | null | undefined
  visualStylePresetSource: string | null | undefined
  visualStylePresetId: string | null | undefined
  videoModel: string | null | undefined
  singleShotVideoModel: string | null | undefined
  sequenceVideoModel: string | null | undefined
  capabilityOverrides: CapabilitySelections
  userVideoModels: WorkspaceVideoModelOption[]
  onNovelTextChange: (value: string) => Promise<void>
  onVideoRatioChange: (value: string) => Promise<void>
  onArtStyleChange: (value: string) => Promise<void>
  onVisualStylePresetChange: (value: { presetSource: 'system' | 'user'; presetId: string }) => Promise<void>
  onRequestAssistantPlan: () => Promise<void>
  onGenerateEditScreenplay: (prompt: string) => Promise<void>
  onConfirmEditStylePreview: (stylePreviewId: string) => Promise<void>
  onGenerateEditDirectorDecoupage: (screenplayId?: string) => Promise<void>
  onGenerateEditScript: (screenplayId?: string) => Promise<void>
  onRegenerateStoryboardText: (storyboardId: string) => Promise<void>
  onClipUpdate: (clipId: string, data: unknown) => Promise<void>
  onOpenAssetLibrary: () => void
  onGeneratePanelImage: (panelId: string, count?: number) => Promise<void>
  onSelectPanelCandidate: (panelId: string, imageUrl: string) => Promise<void>
  onCancelPanelCandidate: (panelId: string) => Promise<void>
  onGenerateVideo: (
    storyboardId: string,
    panelIndex: number,
    model?: string,
    firstLastFrame?: {
      lastFrameStoryboardId: string
      lastFramePanelIndex: number
      flModel: string
      customPrompt?: string
    },
    generationOptions?: VideoGenerationOptions,
    panelId?: string,
  ) => Promise<void>
  onGenerateAllVideos: (options?: BatchVideoGenerationParams) => Promise<void>
  onGenerateBgmScore: () => Promise<void>
  onRenderFinalVideo: () => Promise<void>
  onGenerateEditAssets: (editScriptId: string, requirementId?: string) => Promise<void>
  onGenerateEditCinematographyShotPlan: (editScriptId: string) => Promise<void>
  onRegenerateProjectAssetImage: (assetId: string, kind: 'character' | 'location') => Promise<void>
  onGenerateEditStoryboard: (editScriptId: string) => Promise<void>
  onGenerateEditStoryboardSpatialBlocking: (editScriptId: string) => Promise<void>
  onUpdateVideoPrompt: (
    storyboardId: string,
    panelIndex: number,
    value: string,
    field?: 'imagePrompt' | 'videoPrompt' | 'firstLastFramePrompt',
  ) => Promise<void>
  onUpdateVideoPlanPrompt: (editScriptId: string, blockIndex: number, prompt: string) => Promise<void>
  onArrangeVideoBlocks: (editScriptId: string, blocks: readonly WorkspaceVideoBlockArrangementBlock[]) => Promise<void>
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
