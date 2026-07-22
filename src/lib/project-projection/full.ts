import { assembleProjectProjectionLite } from '@/lib/project-projection/lite'
import { listProjectCreativeResourceCards } from '@/lib/creative-resource/view-service'
import type { ProjectProjectionFull } from './types'

export async function assembleProjectProjectionFull(params: {
  projectId: string
  userId: string
  episodeId?: string | null
  selectedScopeRef?: string | null
  segmentId?: string | null
}): Promise<ProjectProjectionFull> {
  const episodeId = params.episodeId ?? null
  const [base, creativeResources] = await Promise.all([
    assembleProjectProjectionLite({
      projectId: params.projectId,
      userId: params.userId,
      episodeId,
      selectedScopeRef: params.selectedScopeRef ?? null,
    }),
    listProjectCreativeResourceCards({
      projectId: params.projectId,
      userId: params.userId,
      episodeId,
    }),
  ])
  return {
    ...base,
    creativeResources,
  }
}
