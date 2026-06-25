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
    activePlanRuns: context.activePlanRuns,
    activeOperationTasks: context.activeOperationTasks,
    recentOperationResults: context.recentOperationResults,
    latestArtifacts: context.latestArtifacts,
    editScreenplay: context.episodeDetail?.editScreenplay ?? null,
    editScript: context.episodeDetail?.editScript ?? null,
    editFirstWorkflow: context.editFirstWorkflow,
    config: {
      analysisModel: context.policy.analysisModel || null,
      videoRatio: context.policy.videoRatio,
    },
  }
}
