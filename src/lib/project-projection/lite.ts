import { prisma } from '@/lib/prisma'
import { getProjectModelConfig } from '@/lib/config-service'
import { listPlanArtifacts, listPlanRuns } from '@/lib/plan-run-runtime/service'
import { resolveProjectContextPolicy } from '@/lib/project-context/policy'
import type { ProjectProjectionLite, ProjectProjectionProgress } from './types'

type ApprovalSummaryRow = {
  id: string
  status: string
  createdAt: Date
}

async function listLatestArtifactsForContext(params: {
  userId: string
  projectId: string
  episodeId?: string | null
}) {
  const latestRun = (await listPlanRuns({
    userId: params.userId,
    projectId: params.projectId,
    episodeId: params.episodeId || undefined,
    limit: 1,
  }))[0] || null
  if (!latestRun) return []
  const artifacts = await listPlanArtifacts({
    planRunId: latestRun.id,
    limit: 20,
  })
  return artifacts.map((artifact) => ({
    type: artifact.artifactType,
    refId: artifact.refId,
    createdAt: artifact.createdAt,
  }))
}

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
  const [project, episode, progress, runs, latestArtifacts, approvals, projectModelConfig] = await Promise.all([
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
    listPlanRuns({
      userId: params.userId,
      projectId: params.projectId,
      episodeId: episodeId || undefined,
      statuses: ['queued', 'running', 'canceling'],
      limit: 10,
    }),
    listLatestArtifactsForContext({
      userId: params.userId,
      projectId: params.projectId,
      episodeId: episodeId || undefined,
    }),
    episodeId
      ? prisma.planApproval.findMany({
          where: {
            projectId: params.projectId,
            status: {
              in: ['pending', 'approved'],
            },
            plan: {
              episodeId,
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }) as Promise<ApprovalSummaryRow[]>
      : Promise.resolve([] as ApprovalSummaryRow[]),
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
    latestArtifacts,
    activePlanRuns: runs.map((run) => ({
      id: run.id,
      runType: 'plan_run',
      status: run.status,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    })),
    approvals: approvals.map((approval) => ({
      id: approval.id,
      status: approval.status,
      createdAt: approval.createdAt.toISOString(),
    })),
  }
}
