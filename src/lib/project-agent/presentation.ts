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
    selectedAssetId: context.selectedAssetId,
    activeOperationTasks: context.activeOperationTasks,
    recentOperationResults: context.recentOperationResults,
    storyCanon: context.episodeDetail?.storyCanon ?? null,
    chapters: context.episodeDetail?.chapters ?? [],
    config: {
      videoRatio: context.policy.videoRatio,
    },
  }
}
