'use client'

import type { UserModelsPayload } from './useWorkspaceUserModels'
import type { TaskPresentationState } from '@/lib/task/presentation'
import type { CapabilitySelections } from '@/lib/ai-registry/types'
import { VideoPricingTier } from '@/lib/ai-registry/video-capabilities'

interface ProjectSnapshotInput {
  projectData: unknown
  projectCharacters: unknown[]
  projectLocations: unknown[]
  globalAssetText: string
  novelText: string
  analysisModel: string | undefined
  characterModel: string | undefined
  locationModel: string | undefined
  editModel: string | undefined
  videoModel: string | undefined
  musicModel: string | undefined
  videoRatio: string | undefined
  capabilityOverrides: CapabilitySelections
}

interface BuildWorkspaceControllerViewModelParams {
  t: (key: string, values?: Record<string, string | number | Date>) => string
  tc: (key: string, values?: Record<string, string | number | Date>) => string
  te: (key: string, values?: Record<string, string | number | Date>) => string
  projectSnapshot: ProjectSnapshotInput
  uiState: {
    onRefresh: (options?: { mode?: 'full' | 'light' | 'assets' }) => Promise<void>
    assetsLoading: boolean
    assetsLoadingState: TaskPresentationState | null
    isSettingsModalOpen: boolean
    setIsSettingsModalOpen: (open: boolean) => void
    isWorldContextModalOpen: boolean
    setIsWorldContextModalOpen: (open: boolean) => void
    isAssetLibraryOpen: boolean
    assetLibraryFocusCharacterId: string | null
    assetLibraryFocusRequestId: number
    openAssetLibrary: (characterId?: string | null) => void
    closeAssetLibrary: () => void
    userModelsForSettings: UserModelsPayload | null
    userVideoModels: Array<{
      value: string
      label: string
      capabilities?: UserModelsPayload['video'][number]['capabilities']
      videoPricingTiers?: VideoPricingTier[]
    }>
    userModelsLoaded: boolean
  }
  rebuildState: {
    showRebuildConfirm: boolean
    rebuildConfirmTitle: string
    rebuildConfirmMessage: string
    handleCancelRebuildConfirm: () => void
    handleAcceptRebuildConfirm: () => void
  }
  executionState: {
    isConfirmingAssets: boolean
    isTransitioning: boolean
    transitionProgress: { step?: string; total?: number; current?: number }
    requestAssistantGuidance: () => Promise<void>
    showCreatingToast: boolean
  }
  actionsState: {
    handleUpdateConfig: (key: string, value: unknown) => Promise<void>
    handleUpdateConfigPatch: (patch: Record<string, unknown>) => Promise<void>
    handleUpdateEpisode: (key: string, value: unknown) => Promise<void>
  }
}

export function buildWorkspaceControllerViewModel({
  t,
  tc,
  te,
  projectSnapshot,
  uiState,
  rebuildState,
  executionState,
  actionsState,
}: BuildWorkspaceControllerViewModelParams) {
  return {
    i18n: { t, tc, te },
    project: projectSnapshot,
    ui: uiState,
    rebuild: rebuildState,
    execution: executionState,
    actions: actionsState,
  }
}
