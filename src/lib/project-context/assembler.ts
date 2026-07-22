import { getProjectModelConfig } from '@/lib/config-service'
import { readEpisodeEditBible, readEpisodeEditChapters } from '@/lib/edit-bible/service'
import { prisma } from '@/lib/prisma'
import { normalizeTaskOperationResult, type OperationResultTaskRow } from '@/lib/task/operation-result-normalizer'
import { resolveProjectContextPolicy } from './policy'
import type { ProjectContextSnapshot } from './types'

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
  const [project, episode, editBible, chapters, activeOperationTasks, recentOperationResults, projectModelConfig] = await Promise.all([
    prisma.project.findFirst({ where: { id: params.projectId, userId: params.userId } }),
    params.episodeId
      ? prisma.projectEpisode.findFirst({
          where: { id: params.episodeId, projectId: params.projectId },
          select: { id: true, name: true },
        })
      : Promise.resolve(null),
    params.episodeId
      ? readEpisodeEditBible({ projectId: params.projectId, episodeId: params.episodeId })
      : Promise.resolve(null),
    params.episodeId
      ? readEpisodeEditChapters({ projectId: params.projectId, episodeId: params.episodeId })
      : Promise.resolve([]),
    listOperationResultsForContext({
      userId: params.userId,
      projectId: params.projectId,
      statuses: ['queued', 'processing'],
    }),
    listOperationResultsForContext({
      userId: params.userId,
      projectId: params.projectId,
      statuses: ['completed', 'failed', 'canceled'],
    }),
    getProjectModelConfig(params.projectId, params.userId),
  ])
  if (!project) throw new Error(`PROJECT_CONTEXT_NOT_FOUND:${params.projectId}`)
  if (params.episodeId && !episode) throw new Error(`PROJECT_CONTEXT_EPISODE_NOT_FOUND:${params.episodeId}`)

  const policy = resolveProjectContextPolicy({
    projectId: params.projectId,
    episodeId: episode?.id ?? null,
    projectPolicy: {
      projectId: params.projectId,
      episodeId: episode?.id ?? null,
      videoRatio: projectModelConfig.videoRatio ?? project.videoRatio,
      analysisModel: projectModelConfig.analysisModel,
      overrides: {},
    },
  })

  return {
    projectId: project.id,
    projectName: project.name,
    episodeId: episode?.id ?? null,
    episodeName: episode?.name ?? null,
    selectedScopeRef: params.selectedScopeRef ?? null,
    selectedAssetId: params.selectedAssetId ?? null,
    activeOperationTasks,
    recentOperationResults,
    policy,
    episodeDetail: {
      editBible: editBible ? {
        id: editBible.id,
        sourceResourceId: editBible.sourceResourceId,
        sourceRevisionId: editBible.sourceRevisionId,
        bibleResourceId: editBible.bibleResourceId,
        bibleRevisionId: editBible.bibleRevisionId,
        version: editBible.version,
        updatedAt: editBible.updatedAt.toISOString(),
      } : null,
      chapters: chapters.map((chapter) => ({
        id: chapter.id,
        chapterIndex: chapter.chapterIndex,
        title: chapter.title,
        summary: chapter.summary,
        sourceStart: chapter.sourceStart,
        sourceEnd: chapter.sourceEnd,
        targetDurationSec: chapter.targetDurationSec,
        beatIds: chapter.beatIds,
        eventIds: chapter.eventIds,
      })),
    },
  }
}
