import type { ProjectContextSnapshot } from '@/lib/project-context/types'
import type {
  ProjectAssistantContextSnapshot,
} from './types'

export function buildAssistantProjectContextSnapshot(
  context: ProjectContextSnapshot,
): ProjectAssistantContextSnapshot {
  return {
    projectId: context.projectId,
    projectName: context.projectName,
    episodeId: context.episodeId,
    episodeName: context.episodeName,
    selectedScopeRef: context.selectedScopeRef,
    selectedPanelId: context.selectedPanelId,
    selectedAssetId: context.selectedAssetId,
    activeOperationTasks: context.activeOperationTasks,
    recentOperationResults: context.recentOperationResults,
    editBible: context.episodeDetail?.editBible ?? null,
    editScript: context.episodeDetail?.editScript ?? null,
    editScripts: context.episodeDetail?.editScripts ?? [],
    editFirstWorkflow: context.editFirstWorkflow,
    config: {
      analysisModel: context.policy.analysisModel || null,
      videoRatio: context.policy.videoRatio,
    },
  }
}
