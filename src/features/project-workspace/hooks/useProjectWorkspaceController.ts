'use client'

import { logInfo as _ulogInfo } from '@/lib/logging/core'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import { useWorkspaceProvider } from '../WorkspaceProvider'
import { useWorkspaceUserModels } from './useWorkspaceUserModels'
import { useWorkspaceExecution } from './useWorkspaceExecution'
import { useWorkspaceVideoActions } from './useWorkspaceVideoActions'
import { useWorkspaceAssetLibraryShell } from './useWorkspaceAssetLibraryShell'
import { useWorkspaceProjectSnapshot } from './useWorkspaceProjectSnapshot'
import { useWorkspaceModalEscape } from './useWorkspaceModalEscape'
import { useWorkspaceRuntime } from './useWorkspaceRuntime'
import { useWorkspaceConfigActions } from './useWorkspaceConfigActions'
import { buildWorkspaceControllerViewModel } from './workspace-controller-view-model'
import type { ProjectWorkspaceProps } from '../types'
import { useRouter } from '@/i18n/navigation'
import {
  useCreateProjectEditBible,
  useCreateProjectEditScript,
  useCreateProjectEditShotExecutionPlan,
  useUpdateProjectEditScriptAssetRequirementDescription,
} from '@/lib/query/hooks'
import type { WorkspaceEditBibleGenerationInput } from '../WorkspaceRuntimeContext'

export function useProjectWorkspaceController({
  project,
  projectId,
  episodeId,
  episode,
}: ProjectWorkspaceProps) {
  const t = useTranslations('projectWorkflow')
  const te = useTranslations('errors')
  const tc = useTranslations('common')

  const searchParams = useSearchParams()
  const router = useRouter()
  const { onRefresh } = useWorkspaceProvider()

  const projectSnapshot = useWorkspaceProjectSnapshot({ project, episode })

  const assetsLoading = false
  const assetsLoadingState = assetsLoading
    ? resolveTaskPresentationState({
      phase: 'processing',
      intent: 'process',
      resource: 'image',
      hasOutput: false,
    })
    : null

  useEffect(() => {
    _ulogInfo(
      '[ProjectWorkspace] project prop 更新, characters:',
      project?.characters?.length,
    )
  }, [project])

  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false)
  const [isWorldContextModalOpen, setIsWorldContextModalOpen] = useState(false)

  const assetLibrary = useWorkspaceAssetLibraryShell({
    searchParams,
    router,
  })

  useWorkspaceModalEscape({
    isAssetLibraryOpen: assetLibrary.isAssetLibraryOpen,
    closeAssetLibrary: assetLibrary.closeAssetLibrary,
    isSettingsModalOpen,
    setIsSettingsModalOpen,
    isWorldContextModalOpen,
    setIsWorldContextModalOpen,
  })

  const configActions = useWorkspaceConfigActions({
    projectId,
    episodeId,
  })

  const rebuildState = {
    showRebuildConfirm: false,
    rebuildConfirmTitle: '',
    rebuildConfirmMessage: '',
    handleCancelRebuildConfirm: () => undefined,
    handleAcceptRebuildConfirm: () => undefined,
  }

  const userModels = useWorkspaceUserModels()

  const execution = useWorkspaceExecution({
    projectId,
    episodeId,
    t,
  })

  const videoActions = useWorkspaceVideoActions({
    projectId,
    episodeId,
    t,
  })
  const createEditBible = useCreateProjectEditBible(projectId)
  const createEditScript = useCreateProjectEditScript(projectId)
  const createEditShotExecutionPlan = useCreateProjectEditShotExecutionPlan(projectId)
  const updateEditAssetRequirementDescription = useUpdateProjectEditScriptAssetRequirementDescription(projectId)
  const handleGenerateEditBible = async (input: WorkspaceEditBibleGenerationInput) => {
    if (!episodeId) throw new Error('Episode ID is required')
    await createEditBible.mutateAsync({
      episodeId,
      text: input.prompt,
      sourceKind: 'prompt_generated_outline',
    })
    await onRefresh({ mode: 'full' })
  }
  const handleGenerateEditScript = async () => {
    if (!episodeId) throw new Error('Episode ID is required')
    await createEditScript.mutateAsync({
      episodeId,
    })
    await onRefresh({ mode: 'full' })
  }
  const handleGenerateEditShotExecutionPlan = async (editScriptId: string) => {
    if (!episodeId) throw new Error('Episode ID is required')
    await createEditShotExecutionPlan.mutateAsync({
      episodeId,
      editScriptId,
    })
    await onRefresh({ mode: 'full' })
  }
  const handleUpdateEditAssetRequirementDescription = async (editScriptId: string, requirementId: string, description: string) => {
    if (!episodeId) throw new Error('Episode ID is required')
    await updateEditAssetRequirementDescription.mutateAsync({ episodeId, editScriptId, requirementId, description })
    await onRefresh({ mode: 'full' })
  }

  const workspaceRuntime = useWorkspaceRuntime({
    assetsLoading,
    isTransitioning: execution.isTransitioning,
    isConfirmingAssets: execution.isConfirmingAssets,
    isAssistantWorkflowStarting: createEditBible.isPending || createEditScript.isPending || createEditShotExecutionPlan.isPending,
    videoRatio: projectSnapshot.videoRatio,
    videoModel: projectSnapshot.videoModel,
    capabilityOverrides: projectSnapshot.capabilityOverrides,
    userVideoModels: userModels.userVideoModels || [],
    handleUpdateEpisode: configActions.handleUpdateEpisode,
    handleUpdateConfig: configActions.handleUpdateConfig,
    onRequestAssistantGuidance: execution.requestAssistantGuidance,
    handleGenerateEditBible,
    handleGenerateEditScript,
    openAssetLibrary: assetLibrary.openAssetLibrary,
    handlePlanBgmScore: videoActions.handlePlanBgmScore,
    handlePlanAmbientSound: videoActions.handlePlanAmbientSound,
    handleRenderFinalVideo: videoActions.handleRenderFinalVideo,
    handleGenerateEditShotExecutionPlan,
    handleUpdateEditAssetRequirementDescription,
  })

  const uiState = {
    onRefresh,
    assetsLoading,
    assetsLoadingState,
    isSettingsModalOpen,
    setIsSettingsModalOpen,
    isWorldContextModalOpen,
    setIsWorldContextModalOpen,
    isAssetLibraryOpen: assetLibrary.isAssetLibraryOpen,
    assetLibraryFocusCharacterId: assetLibrary.assetLibraryFocusCharacterId,
    assetLibraryFocusRequestId: assetLibrary.assetLibraryFocusRequestId,
    openAssetLibrary: assetLibrary.openAssetLibrary,
    closeAssetLibrary: assetLibrary.closeAssetLibrary,
    userModelsForSettings: userModels.userModelsForSettings,
    userVideoModels: userModels.userVideoModels || [],
    userModelsLoaded: userModels.userModelsLoaded,
  }

  const executionState = {
    isConfirmingAssets: execution.isConfirmingAssets,
    isTransitioning: execution.isTransitioning,
    isAssistantWorkflowStarting: false,
    transitionProgress: execution.transitionProgress,
    requestAssistantGuidance: execution.requestAssistantGuidance,
    showCreatingToast: execution.showCreatingToast,
  }

  const actionsState = {
    handleUpdateConfig: configActions.handleUpdateConfig,
    handleUpdateConfigPatch: configActions.handleUpdateConfigPatch,
    handleUpdateEpisode: configActions.handleUpdateEpisode,
  }

  return buildWorkspaceControllerViewModel({
    t,
    tc,
    te,
    projectSnapshot,
    uiState,
    rebuildState,
    executionState,
    workspaceRuntime,
    actionsState,
  })
}
