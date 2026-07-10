import { prisma } from '@/lib/prisma'
import { getProjectModelConfig } from '@/lib/config-service'
import { resolveProjectContextPolicy } from '@/lib/project-context/policy'
import type { ProjectProjectionLite, ProjectProjectionProgress } from './types'

async function resolveEpisodeProgress(episodeId: string | null): Promise<ProjectProjectionProgress> {
  if (!episodeId) {
    return {
      storyboardCount: 0,
      panelCount: 0,
    }
  }

  const [storyboardCount, panelCount] = await Promise.all([
    prisma.projectStoryboard.count({
      where: {
        episodeId,
      },
    }),
    prisma.projectPanel.count({
      where: {
        storyboard: {
          episodeId,
        },
      },
    }),
  ])

  return {
    storyboardCount,
    panelCount,
  }
}

export async function assembleProjectProjectionLite(params: {
  projectId: string
  userId: string
  episodeId?: string | null
  selectedScopeRef?: string | null
}): Promise<ProjectProjectionLite> {
  const episodeId = params.episodeId || null
  const [project, episode, progress, projectModelConfig] = await Promise.all([
    prisma.project.findUnique({
      where: { id: params.projectId },
      select: {
        id: true,
        name: true,
        videoRatio: true,
      },
    }),
    episodeId
      ? prisma.projectEpisode.findUnique({
          where: { id: episodeId },
          select: { id: true, name: true },
        })
      : Promise.resolve(null),
    resolveEpisodeProgress(episodeId),
    getProjectModelConfig(params.projectId, params.userId),
  ])

  if (!project) {
    throw new Error(`PROJECT_PROJECTION_NOT_FOUND: ${params.projectId}`)
  }

  const policy = resolveProjectContextPolicy({
    projectId: params.projectId,
    episodeId,
    projectPolicy: {
      projectId: params.projectId,
      episodeId,
      videoRatio: projectModelConfig.videoRatio || project.videoRatio,
      analysisModel: projectModelConfig.analysisModel,
      overrides: {},
    },
  })

  return {
    projectId: project.id,
    projectName: project.name,
    episodeId: episode?.id || null,
    episodeName: episode?.name || null,
    selectedScopeRef: params.selectedScopeRef || null,
    policy,
    progress,
  }
}
