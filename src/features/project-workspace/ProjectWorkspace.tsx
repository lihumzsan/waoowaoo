'use client'

import { useEffect, useState } from 'react'
import ProgressToast from '@/components/ProgressToast'
import ConfirmDialog from '@/components/ConfirmDialog'
import { AnimatedBackground } from '@/components/ui/SharedComponents'
import { apiFetch } from '@/lib/api-fetch'
import { WorkspaceProvider } from './WorkspaceProvider'
import WorkspaceAssetLibraryModal from './components/WorkspaceAssetLibraryModal'
import WorkspaceAssistantPanel from './components/WorkspaceAssistantPanel'
import WorkspaceHeaderShell from './components/WorkspaceHeaderShell'
import WorkflowLabPanel from './components/WorkflowLabPanel'
import ProjectWorkspaceCanvas from './canvas/ProjectWorkspaceCanvas'
import type { WorkspaceAssistantSelectionContext } from './canvas/ProjectWorkspaceCanvas'
import { WorkspaceRuntimeProvider } from './WorkspaceRuntimeContext'
import { useProjectWorkspaceController } from './hooks/useProjectWorkspaceController'
import type { ProjectWorkspaceProps } from './types'
import '@/styles/animations.css'

type DeploymentPayload = {
  deployment?: {
    isCloud?: boolean
  }
}

function isDeploymentPayload(value: unknown): value is DeploymentPayload {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function ProjectWorkspaceContent(props: ProjectWorkspaceProps) {
  const vm = useProjectWorkspaceController(props)
  const [isAssistantPanelCollapsed, setIsAssistantPanelCollapsed] = useState(false)
  const [assistantSelection, setAssistantSelection] = useState<WorkspaceAssistantSelectionContext>({})
  const [activeAssistantOperationId, setActiveAssistantOperationId] = useState<string | null>(null)
  const [projectConfigurable, setProjectConfigurable] = useState(true)
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

  useEffect(() => {
    let canceled = false

    const loadDeployment = async () => {
      const response = await apiFetch('/api/deployment')
      if (!response.ok) return
      const payload: unknown = await response.json()
      if (!canceled && isDeploymentPayload(payload)) {
        setProjectConfigurable(payload.deployment?.isCloud !== true)
      }
    }

    void loadDeployment()
    return () => {
      canceled = true
    }
  }, [])

  if (!vm.project.projectData) {
    return <div className="text-center text-(--glass-text-secondary)">{vm.i18n.tc('loading')}</div>
  }

  return (
    <div className={isEpisodeWorkspace ? 'h-full min-h-0 overflow-hidden' : undefined}>
      <AnimatedBackground />

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
        storyboardModel={vm.project.storyboardModel}
        editModel={vm.project.editModel}
        videoModel={vm.project.videoModel}
        singleShotVideoModel={vm.project.singleShotVideoModel}
        sequenceVideoModel={vm.project.sequenceVideoModel}
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
        onOpenAssetLibrary={() => vm.ui.openAssetLibrary()}
        onOpenSettingsModal={() => vm.ui.setIsSettingsModalOpen(true)}
        projectConfigurable={projectConfigurable}
        onRefresh={() => vm.ui.onRefresh({ mode: 'full' })}
        assetLibraryLabel={vm.i18n.t('buttons.assetLibrary')}
        settingsLabel={vm.i18n.t('buttons.settings')}
        refreshTitle={vm.i18n.t('buttons.refreshData')}
      />

      <div className={isEpisodeWorkspace ? 'h-full min-h-0 overflow-hidden' : undefined}>
        <div className={isEpisodeWorkspace ? 'h-full min-h-0 overflow-hidden' : undefined}>
          <WorkspaceAssistantPanel
            projectId={projectId}
            episodeId={episodeId}
            selection={assistantSelection}
            autoStartMessage={props.assistantAutoStartMessage ?? null}
            autoStartKey={props.assistantAutoStartKey ?? null}
            onAutoStartConsumed={props.onAssistantAutoStartConsumed}
            isCollapsed={isAssistantPanelCollapsed}
            onToggleCollapsed={() => setIsAssistantPanelCollapsed((current) => !current)}
            onActiveOperationChange={setActiveAssistantOperationId}
          />
          {props.workflowLabEnabled && isEpisodeWorkspace ? (
            <WorkflowLabPanel
              projectId={projectId}
              episodeId={episodeId}
              enabled={props.workflowLabEnabled}
              onEpisodeForked={props.onWorkflowLabEpisodeForked}
            />
          ) : null}

          <div className={isEpisodeWorkspace ? 'h-full min-w-0 overflow-hidden' : 'min-w-0'}>
            <WorkspaceRuntimeProvider value={vm.runtime.workspaceRuntime}>
              <ProjectWorkspaceCanvas
                onAssistantSelectionChange={setAssistantSelection}
                activeAssistantOperationId={activeAssistantOperationId}
              />
            </WorkspaceRuntimeProvider>
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
          isAnalyzingAssets={vm.execution.isAssetAnalysisRunning}
          focusCharacterId={vm.ui.assetLibraryFocusCharacterId}
          focusCharacterRequestId={vm.ui.assetLibraryFocusRequestId}
          triggerGlobalAnalyze={vm.ui.triggerGlobalAnalyzeOnOpen}
          onGlobalAnalyzeComplete={() => vm.ui.setTriggerGlobalAnalyzeOnOpen(false)}
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
