import { prisma } from '@/lib/prisma'
import { getProjectModelConfig } from '@/lib/config-service'
import { resolveProjectContextPolicy } from '@/lib/project-context/policy'
import type { ProjectProjectionLite, ProjectProjectionResourceSummary } from './types'

async function resolveResourceSummary(projectId: string, episodeId: string | null): Promise<ProjectProjectionResourceSummary> {
  const scope = { projectId, episodeId }
  const [totalCount, readyCount, failedCount] = await Promise.all([
    prisma.creativeResource.count({ where: scope }),
    prisma.creativeResource.count({
      where: { ...scope, status: 'ready', headRevisionId: { not: null } },
    }),
    prisma.creativeResource.count({ where: { ...scope, status: 'failed' } }),
  ])

  return {
    totalCount,
    readyCount,
    failedCount,
  }
}

export async function assembleProjectProjectionLite(params: {
  projectId: string
  userId: string
  episodeId?: string | null
  selectedScopeRef?: string | null
}): Promise<ProjectProjectionLite> {
  const episodeId = params.episodeId || null
  const [project, episode, resources, projectModelConfig] = await Promise.all([
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
    resolveResourceSummary(params.projectId, episodeId),
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
      videoRatio: projectModelConfig.videoRatio ?? project.videoRatio,
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
    resources,
  }
}
