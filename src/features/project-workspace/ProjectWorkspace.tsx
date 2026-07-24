'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import ProgressToast from '@/components/ProgressToast'
import ConfirmDialog from '@/components/ConfirmDialog'
import { BrandLoading } from '@/components/ui/BrandLoading'
import { apiFetch } from '@/lib/api-fetch'
import { useProjectStoryCanonResponse } from '@/lib/query/hooks'
import { WorkspaceProvider } from './WorkspaceProvider'
import WorkspaceAssetLibraryModal from './components/WorkspaceAssetLibraryModal'
import WorkspaceAssistantPanel from './components/WorkspaceAssistantPanel'
import WorkspaceHeaderShell from './components/WorkspaceHeaderShell'
import ProjectWorkspaceCanvas from './canvas/ProjectWorkspaceCanvas'
import type { WorkspaceAssistantSelectionContext } from './canvas/ProjectWorkspaceCanvas'
import type { WorkspaceAssistantActiveFocusRequest } from './workspace-assistant-focus'
import { useProjectWorkspaceController } from './hooks/useProjectWorkspaceController'
import type { ProjectWorkspaceProps } from './types'
import {
  WORKSPACE_SCOPE_ALL_ID,
  readWorkspaceScopeId,
  type WorkspaceScopeId,
} from './workspace-scope'
import { isPublicDeploymentFeatures, type PublicDeploymentFeatures } from '@/lib/deployment/public-client'
import '@/styles/animations.css'

type DeploymentPayload = {
  features?: PublicDeploymentFeatures
}

type WorkspaceScopeSelection = {
  episodeId: string | null
  scopeId: WorkspaceScopeId
}

function isDeploymentPayload(value: unknown): value is DeploymentPayload {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function ProjectWorkspaceContent(props: ProjectWorkspaceProps) {
  const vm = useProjectWorkspaceController(props)
  const [assistantSelection, setAssistantSelection] = useState<WorkspaceAssistantSelectionContext>({})
  const [activeAssistantFocusRequest, setActiveAssistantFocusRequest] = useState<WorkspaceAssistantActiveFocusRequest | null>(null)
  const [projectConfigurable, setProjectConfigurable] = useState(true)
  const [workspaceScopeSelection, setWorkspaceScopeSelection] = useState<WorkspaceScopeSelection>(() => ({
    episodeId: props.episodeId ?? null,
    scopeId: WORKSPACE_SCOPE_ALL_ID,
  }))
  const isEpisodeWorkspace = props.viewMode === 'episode'

  const {
    project,
    projectId,
    episodeId,
    episodes = [],
    onEpisodeSelect,
    onEpisodeCreate,
    onEpisodeRename,
    onEpisodeDelete,
    onProjectRename,
  } = props
  const { data: storyCanonResponse } = useProjectStoryCanonResponse(projectId, episodeId ?? null)
  const storyCanonForWorkspace = storyCanonResponse?.storyCanon ?? null
  const workspaceChapters = useMemo(
    () => storyCanonResponse?.chapters ?? [],
    [storyCanonResponse?.chapters],
  )
  const workspaceEpisodeId = episodeId ?? null
  const selectedWorkspaceScope = readWorkspaceScopeId(workspaceScopeSelection.scopeId)
  const workspaceScopeId = workspaceScopeSelection.episodeId === workspaceEpisodeId
    && (
      selectedWorkspaceScope.kind !== 'chapter'
      || workspaceChapters.some((chapter) => chapter.id === selectedWorkspaceScope.chapterId)
    )
    ? workspaceScopeSelection.scopeId
    : WORKSPACE_SCOPE_ALL_ID
  const handleWorkspaceScopeSelect = useCallback((scopeId: WorkspaceScopeId) => {
    setWorkspaceScopeSelection({ episodeId: workspaceEpisodeId, scopeId })
  }, [workspaceEpisodeId])

  useEffect(() => {
    let canceled = false

    const loadDeployment = async () => {
      const response = await apiFetch('/api/deployment')
      if (!response.ok) return
      const payload: unknown = await response.json()
      if (!canceled && isDeploymentPayload(payload) && isPublicDeploymentFeatures(payload.features)) {
        setProjectConfigurable(payload.features.showApiConfig)
      }
    }

    void loadDeployment()
    return () => {
      canceled = true
    }
  }, [])

  if (!vm.project.projectData) {
    return <BrandLoading className="h-full min-h-[240px]" />
  }

  return (
    <div className={isEpisodeWorkspace ? 'h-full min-h-0 overflow-hidden' : undefined}>
      <WorkspaceHeaderShell
        isSettingsModalOpen={vm.ui.isSettingsModalOpen}
        isWorldContextModalOpen={vm.ui.isWorldContextModalOpen}
        onCloseSettingsModal={() => vm.ui.setIsSettingsModalOpen(false)}
        onCloseWorldContextModal={() => vm.ui.setIsWorldContextModalOpen(false)}
        availableModels={vm.ui.userModelsForSettings || undefined}
        modelsLoaded={vm.ui.userModelsLoaded}
        analysisModel={vm.project.analysisModel}
        characterModel={vm.project.characterModel}
        locationModel={vm.project.locationModel}
        editModel={vm.project.editModel}
        videoModel={vm.project.videoModel}
        musicModel={vm.project.musicModel}
        capabilityOverrides={vm.project.capabilityOverrides}
        videoRatio={vm.project.videoRatio}
        onUpdateConfig={vm.actions.handleUpdateConfig}
        onUpdateConfigPatch={vm.actions.handleUpdateConfigPatch}
        globalAssetText={vm.project.globalAssetText}
        projectName={project.name}
        episodes={episodes}
        currentEpisodeId={episodeId}
        onEpisodeSelect={onEpisodeSelect}
        onEpisodeCreate={onEpisodeCreate}
        onEpisodeRename={onEpisodeRename}
        onEpisodeDelete={onEpisodeDelete}
        onProjectRename={onProjectRename}
        projectConfigurable={projectConfigurable}
        currentStoryCanon={storyCanonForWorkspace ?? null}
        workspaceChapters={workspaceChapters}
        currentWorkspaceScopeId={workspaceScopeId}
        onWorkspaceScopeSelect={handleWorkspaceScopeSelect}
      />

      <div className={isEpisodeWorkspace ? 'h-full min-h-0 overflow-hidden' : undefined}>
        <div className={isEpisodeWorkspace ? 'h-full min-h-0 overflow-hidden' : undefined}>
          <WorkspaceAssistantPanel
            projectId={projectId}
            episodeId={episodeId}
            selection={assistantSelection}
            autoStartDraft={props.assistantAutoStartDraft ?? null}
            autoStartKey={props.assistantAutoStartKey ?? null}
            onAutoStartConsumed={props.onAssistantAutoStartConsumed}
            onActiveOperationChange={setActiveAssistantFocusRequest}
          />
          <div className={isEpisodeWorkspace ? 'h-full min-w-0 overflow-hidden' : 'min-w-0'}>
            <ProjectWorkspaceCanvas
              onAssistantSelectionChange={setAssistantSelection}
              activeAssistantFocusRequest={activeAssistantFocusRequest}
            />
          </div>
        </div>

        <WorkspaceAssetLibraryModal
          isOpen={vm.ui.isAssetLibraryOpen}
          onClose={vm.ui.closeAssetLibrary}
          assetsLoading={vm.ui.assetsLoading}
          assetsLoadingState={vm.ui.assetsLoadingState}
          hasCharacters={vm.project.projectCharacters.length > 0}
          hasLocations={vm.project.projectLocations.length > 0}
          projectId={projectId}
          focusCharacterId={vm.ui.assetLibraryFocusCharacterId}
          focusCharacterRequestId={vm.ui.assetLibraryFocusRequestId}
        />

        {vm.execution.showCreatingToast && (
          <ProgressToast
            show
            message={vm.i18n.t('execution.creating')}
            step={vm.execution.transitionProgress.step || ''}
          />
        )}

        <ConfirmDialog
          show={vm.rebuild.showRebuildConfirm}
          type="warning"
          title={vm.rebuild.rebuildConfirmTitle}
          message={vm.rebuild.rebuildConfirmMessage}
          confirmText={vm.i18n.t('rebuildConfirm.confirm')}
          cancelText={vm.i18n.t('rebuildConfirm.cancel')}
          onConfirm={vm.rebuild.handleAcceptRebuildConfirm}
          onCancel={vm.rebuild.handleCancelRebuildConfirm}
        />
      </div>
    </div>
  )
}

export default function ProjectWorkspace(props: ProjectWorkspaceProps) {
  const { projectId, episodeId } = props
  return (
    <WorkspaceProvider projectId={projectId} episodeId={episodeId}>
      <ProjectWorkspaceContent {...props} />
    </WorkspaceProvider>
  )
}
