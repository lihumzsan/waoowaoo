import { prisma } from '@/lib/prisma'
import { getProjectModelConfig } from '@/lib/config-service'
import { normalizeTaskOperationResult, type OperationResultTaskRow } from '@/lib/task/operation-result-normalizer'
import { resolveEditFirstWorkflowView } from '@/lib/project-workflow/edit-first'
import { editScriptStructureSchema } from '@/lib/edit-script/types'
import { readEpisodeEditChapters } from '@/lib/edit-bible/service'
import { resolveProjectContextPolicy } from './policy'
import type { ProjectContextEditScriptSnapshot, ProjectContextSnapshot } from './types'

function compactPreview(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

function countGenerationSegments(corePlanJson: unknown): number {
  const parsed = editScriptStructureSchema.safeParse(corePlanJson)
  return parsed.success ? parsed.data.generationSegments.length : 0
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
      approvalGrantId: true,
      operationExecutionId: true,
      operationPlanTaskId: true,
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
  selectedAssetId?: string | null
}): Promise<ProjectContextSnapshot> {
  const [project, episode, editBible, editChapters, editScripts, activeOperationTasks, recentOperationResults, editFirstWorkflow, projectModelConfig] = await Promise.all([
    prisma.project.findUnique({
      where: { id: params.projectId },
    }),
    params.episodeId
      ? prisma.projectEpisode.findUnique({
          where: { id: params.episodeId },
          include: {
            videoSegments: {
              orderBy: { createdAt: 'asc' },
              select: {
                id: true,
                editScriptId: true,
                segmentId: true,
                status: true,
                durationSec: true,
                videoMediaId: true,
                errorCode: true,
                errorMessage: true,
                updatedAt: true,
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
      ? prisma.projectEditScript.findMany({
          where: {
            projectId: params.projectId,
            episodeId: params.episodeId,
          },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            chapterId: true,
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
      : Promise.resolve([]),
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
    resolveEditFirstWorkflowView({
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

  const videoSegmentSnapshots = (episode?.videoSegments ?? []).map((segment) => ({
    ...segment,
    updatedAt: segment.updatedAt.toISOString(),
  }))
  const editScriptSnapshots: ProjectContextEditScriptSnapshot[] = editScripts.map((script) => {
    const generationSegmentCount = script.status === 'ready' && script.corePlanJson
      ? countGenerationSegments(script.corePlanJson)
      : 0
    return {
      id: script.id,
      chapterId: script.chapterId,
      status: script.status,
      assetReviewStatus: script.assetReviewStatus === 'approved' ? 'approved' : 'pending',
      durationSec: script.durationSec,
      shotCount: script.shotCount,
      generationSegmentCount,
      requirementCount: script.requirements.length,
      pendingRequirementCount: script.requirements.filter((requirement) => requirement.status !== 'completed').length,
      updatedAt: script.updatedAt.toISOString(),
    }
  })
  const singleEditScript = editScriptSnapshots.length === 1 ? editScriptSnapshots[0] ?? null : null

  return {
    projectId: project.id,
    projectName: project.name,
    episodeId: episode?.id || null,
    episodeName: episode?.name || null,
    selectedScopeRef: params.selectedScopeRef || null,
    selectedAssetId: params.selectedAssetId || null,
    activeOperationTasks,
    recentOperationResults,
    policy,
    editFirstWorkflow,
    episodeDetail: {
      episode: episode
          ? {
            novelText: episode.novelText || null,
            videoSegmentCount: videoSegmentSnapshots.length,
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
      editScript: singleEditScript,
      editScripts: editScriptSnapshots,
      videoSegments: videoSegmentSnapshots,
    },
  }
}
