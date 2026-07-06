import { prisma } from '@/lib/prisma'
import { getProjectModelConfig } from '@/lib/config-service'
import { listPlanArtifacts, listPlanRuns } from '@/lib/plan-run-runtime/service'
import { normalizeTaskOperationResult, type OperationResultTaskRow } from '@/lib/task/operation-result-normalizer'
import { resolveEditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import { editScriptStructureSchema } from '@/lib/edit-script/types'
import { readEpisodeEditChapters } from '@/lib/edit-bible'
import { resolveProjectContextPolicy } from './policy'
import type { ProjectContextSnapshot } from './types'

function compactPreview(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

function countGenerationSegments(corePlanJson: unknown): number {
  return editScriptStructureSchema.parse(corePlanJson).generationSegments.length
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

async function listOperationResultsForContext(params: {
  userId: string
  projectId: string
  statuses: string[]
  limit?: number
}) {
  const rows = await prisma.task.findMany({
    where: {
      userId: params.userId,
      projectId: params.projectId,
      operationId: { not: null },
      status: { in: params.statuses },
    },
    orderBy: { updatedAt: 'desc' },
    take: params.limit ?? 10,
    select: {
      id: true,
      type: true,
      status: true,
      targetType: true,
      targetId: true,
      episodeId: true,
      payload: true,
      result: true,
      errorCode: true,
      errorMessage: true,
      operationId: true,
      operationSource: true,
      operationConfirmed: true,
      queuedAt: true,
      finishedAt: true,
      updatedAt: true,
    },
  })
  return rows
    .map((row) => normalizeTaskOperationResult(row satisfies OperationResultTaskRow))
    .filter((item): item is NonNullable<typeof item> => item !== null)
}

export async function assembleProjectContext(params: {
  projectId: string
  userId: string
  episodeId?: string | null
  selectedScopeRef?: string | null
  selectedPanelId?: string | null
  selectedAssetId?: string | null
}): Promise<ProjectContextSnapshot> {
  const [project, episode, editBible, editChapters, editScript, runs, latestArtifacts, activeOperationTasks, recentOperationResults, editFirstWorkflow, projectModelConfig] = await Promise.all([
    prisma.project.findUnique({
      where: { id: params.projectId },
    }),
    params.episodeId
      ? prisma.projectEpisode.findUnique({
          where: { id: params.episodeId },
          include: {
            storyboards: {
              orderBy: { createdAt: 'asc' },
              include: {
                panels: {
                  orderBy: { panelIndex: 'asc' },
                  select: {
                    id: true,
                    panelIndex: true,
                    description: true,
                    imagePrompt: true,
                    imageUrl: true,
                    imageMediaId: true,
                    candidateImages: true,
                    videoPrompt: true,
                    videoUrl: true,
                    videoMediaId: true,
                    updatedAt: true,
                  },
                },
              },
            },
          },
        })
      : Promise.resolve(null),
    params.episodeId
      ? prisma.projectEditBible.findFirst({
          where: {
            episodeId: params.episodeId,
            episode: { projectId: params.projectId },
          },
          select: {
            id: true,
            status: true,
            bibleJson: true,
            updatedAt: true,
          },
        })
      : Promise.resolve(null),
    params.episodeId
      ? readEpisodeEditChapters({
          projectId: params.projectId,
          episodeId: params.episodeId,
        })
      : Promise.resolve([]),
    params.episodeId
      ? prisma.projectEditScript.findFirst({
          where: {
            projectId: params.projectId,
            episodeId: params.episodeId,
          },
          select: {
            id: true,
            status: true,
            assetReviewStatus: true,
            durationSec: true,
            shotCount: true,
            corePlanJson: true,
            updatedAt: true,
            requirements: {
              select: {
                status: true,
              },
            },
          },
        })
      : Promise.resolve(null),
    listPlanRuns({
      userId: params.userId,
      projectId: params.projectId,
      episodeId: params.episodeId || undefined,
      statuses: ['queued', 'running', 'canceling'],
      limit: 10,
    }),
    listLatestArtifactsForContext({
      userId: params.userId,
      projectId: params.projectId,
      episodeId: params.episodeId || undefined,
    }),
    listOperationResultsForContext({
      userId: params.userId,
      projectId: params.projectId,
      statuses: ['queued', 'processing'],
      limit: 10,
    }),
    listOperationResultsForContext({
      userId: params.userId,
      projectId: params.projectId,
      statuses: ['completed', 'failed', 'canceled'],
      limit: 10,
    }),
    resolveEditFirstWorkflowState({
      projectId: params.projectId,
      userId: params.userId,
      episodeId: params.episodeId || null,
    }),
    getProjectModelConfig(params.projectId, params.userId),
  ])

  if (!project) {
    throw new Error(`PROJECT_CONTEXT_NOT_FOUND: ${params.projectId}`)
  }

  const policy = resolveProjectContextPolicy({
    projectId: params.projectId,
    episodeId: params.episodeId || null,
    projectPolicy: {
      projectId: params.projectId,
      episodeId: params.episodeId || null,
      videoRatio: projectModelConfig.videoRatio || project.videoRatio,
      analysisModel: projectModelConfig.analysisModel,
      overrides: {},
    },
  })

  const panelSnapshots = (episode?.storyboards || []).flatMap((storyboard) =>
    storyboard.panels.map((panel) => ({
      panelId: panel.id,
      editScriptId: storyboard.editScriptId,
      storyboardId: storyboard.id,
      panelIndex: panel.panelIndex,
      description: panel.description,
      imagePrompt: panel.imagePrompt ?? null,
      imageUrl: panel.imageUrl ?? null,
      imageMediaId: panel.imageMediaId ?? null,
      candidateImages: panel.candidateImages ?? null,
      videoPrompt: panel.videoPrompt ?? null,
      videoUrl: panel.videoUrl ?? null,
      videoMediaId: panel.videoMediaId ?? null,
      updatedAt: panel.updatedAt.toISOString(),
    })),
  )
  const storyboardCount = episode?.storyboards.length || 0
  const panelCount = panelSnapshots.length
  const generationSegmentCount = editScript ? countGenerationSegments(editScript.corePlanJson) : 0

  return {
    projectId: project.id,
    projectName: project.name,
    episodeId: episode?.id || null,
    episodeName: episode?.name || null,
    selectedScopeRef: params.selectedScopeRef || null,
    selectedPanelId: params.selectedPanelId || null,
    selectedAssetId: params.selectedAssetId || null,
    latestArtifacts,
    activePlanRuns: runs.map((run) => ({
      id: run.id,
      runType: 'plan_run',
      status: run.status,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    })),
    activeOperationTasks,
    recentOperationResults,
    policy,
    editFirstWorkflow,
    episodeDetail: {
      episode: episode
        ? {
            novelText: episode.novelText || null,
            storyboardCount,
            panelCount,
          }
        : null,
      editBible: editBible
        ? {
            id: editBible.id,
            status: editBible.status,
            userPrompt: 'episode_bible',
            textPreview: compactPreview(JSON.stringify(editBible.bibleJson ?? {}), 600),
            updatedAt: editBible.updatedAt.toISOString(),
        }
        : null,
      chapters: editChapters.map((chapter) => ({
        id: chapter.id,
        chapterIndex: chapter.chapterIndex,
        title: chapter.title,
        summary: chapter.summary,
        sourceStart: chapter.sourceStart,
        sourceEnd: chapter.sourceEnd,
        targetDurationSec: chapter.targetDurationSec,
        status: chapter.status,
        renderStatus: chapter.renderStatus,
        outputMediaId: chapter.outputMediaId,
      })),
      editScript: editScript
        ? {
            id: editScript.id,
            status: editScript.status,
            assetReviewStatus: editScript.assetReviewStatus === 'approved' ? 'approved' : 'pending',
            durationSec: editScript.durationSec,
            shotCount: editScript.shotCount,
            generationSegmentCount,
            requirementCount: editScript.requirements.length,
            pendingRequirementCount: editScript.requirements.filter((requirement) => requirement.status !== 'completed').length,
            updatedAt: editScript.updatedAt.toISOString(),
          }
        : null,
      panels: panelSnapshots,
    },
  }
}
