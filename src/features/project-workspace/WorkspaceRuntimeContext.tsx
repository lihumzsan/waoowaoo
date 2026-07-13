'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { CapabilitySelections, ModelCapabilities } from '@/lib/ai-registry/types'
import { VideoPricingTier } from '@/lib/ai-registry/video-capabilities'

export interface WorkspaceVideoModelOption {
  value: string
  label: string
  provider?: string
  providerName?: string
  capabilities?: ModelCapabilities
  videoPricingTiers?: VideoPricingTier[]
}

export interface WorkspaceEditBibleGenerationInput {
  readonly prompt: string
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
  onGenerateEditBible: (input: WorkspaceEditBibleGenerationInput) => Promise<void>
  onGenerateEditScript: () => Promise<void>
  onOpenAssetLibrary: () => void
  onPlanBgmScore: () => Promise<void>
  onPlanSoundscape: () => Promise<void>
  onRenderFinalVideo: () => Promise<void>
  onGenerateEditShotExecutionPlan: (editScriptId: string) => Promise<void>
  onUpdateVideoPrompt: (
    storyboardId: string,
    panelIndex: number,
    value: string,
    field?: 'imagePrompt' | 'videoPrompt',
  ) => Promise<void>
  onUpdateEditAssetRequirementDescription: (editScriptId: string, requirementId: string, description: string) => Promise<void>
  onUpdatePanelVideoModel: (storyboardId: string, panelIndex: number, model: string) => Promise<void>
  onOpenAssetLibraryForCharacter: (characterId?: string | null) => void
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
