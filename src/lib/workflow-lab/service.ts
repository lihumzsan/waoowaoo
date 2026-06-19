import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import {
  resolveEditFirstWorkflowState,
  type EditFirstWorkflowState,
} from '@/lib/project-workflow/edit-first'
import { cloneEpisodeProjectData } from './clone-episode-project-data'
import type { WorkflowLabEpisodeSummary, WorkflowLabForkResult } from './types'

const WORKFLOW_LAB_NAME_PREFIX = '[LAB]'
const WORKFLOW_LAB_MAX_EPISODES = 200

function isWorkflowLabExplicitlyEnabled(): boolean {
  const value = process.env.WORKFLOW_LAB_ENABLED?.trim().toLowerCase() ?? ''
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

export function isWorkflowLabEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || isWorkflowLabExplicitlyEnabled()
}

function assertWorkflowLabEnabled() {
  if (isWorkflowLabEnabled()) return
  throw new ApiError('FORBIDDEN', {
    code: 'WORKFLOW_LAB_DISABLED',
    message: 'workflow lab is disabled',
  })
}

function summarizeEpisode(
  episode: { readonly id: string; readonly name: string; readonly episodeNumber: number },
  workflow: EditFirstWorkflowState,
): WorkflowLabEpisodeSummary {
  return {
    id: episode.id,
    name: episode.name,
    episodeNumber: episode.episodeNumber,
    workflowStage: workflow.stage,
    blockingKind: workflow.blocking.kind,
    blockingReason: workflow.blocking.reason,
    nextOperationId: workflow.nextAction?.operationId ?? null,
    allowedOperationIds: workflow.allowedOperationIds,
  }
}

function assertForkableWorkflow(workflow: EditFirstWorkflowState) {
  if (workflow.blocking.kind !== 'processing') return
  throw new ApiError('INVALID_PARAMS', {
    code: 'WORKFLOW_LAB_PROCESSING_SOURCE_NOT_FORKABLE',
    message: 'processing workflow checkpoints cannot be forked because active tasks would not follow the forked episode',
  })
}

export async function listWorkflowLabEpisodes(params: {
  readonly projectId: string
  readonly userId: string
}): Promise<readonly WorkflowLabEpisodeSummary[]> {
  assertWorkflowLabEnabled()
  const episodes = await prisma.projectEpisode.findMany({
    where: {
      projectId: params.projectId,
      project: {
        userId: params.userId,
      },
    },
    orderBy: [
      { episodeNumber: 'asc' },
      { createdAt: 'asc' },
    ],
    take: WORKFLOW_LAB_MAX_EPISODES,
    select: {
      id: true,
      name: true,
      episodeNumber: true,
    },
  })

  const summaries = await Promise.all(episodes.map(async (episode) => {
    const workflow = await resolveEditFirstWorkflowState({
      projectId: params.projectId,
      userId: params.userId,
      episodeId: episode.id,
    })
    return summarizeEpisode(episode, workflow)
  }))
  return summaries
}

function buildForkEpisodeName(params: {
  readonly sourceName: string
  readonly sourceStage: string
}): string {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19)
  return `${WORKFLOW_LAB_NAME_PREFIX} ${params.sourceStage} - ${params.sourceName} - ${timestamp}`
}

export async function forkWorkflowLabEpisode(params: {
  readonly projectId: string
  readonly userId: string
  readonly sourceEpisodeId: string
  readonly name?: string | null
}): Promise<WorkflowLabForkResult> {
  assertWorkflowLabEnabled()

  const sourceWorkflow = await resolveEditFirstWorkflowState({
    projectId: params.projectId,
    userId: params.userId,
    episodeId: params.sourceEpisodeId,
  })
  assertForkableWorkflow(sourceWorkflow)

  const result = await prisma.$transaction(async (tx) => {
    const sourceEpisode = await tx.projectEpisode.findFirst({
      where: {
        id: params.sourceEpisodeId,
        projectId: params.projectId,
        project: {
          userId: params.userId,
        },
      },
      select: {
        id: true,
        projectId: true,
        episodeNumber: true,
        name: true,
        description: true,
        novelText: true,
        audioUrl: true,
        audioMediaId: true,
        srtContent: true,
      },
    })
    if (!sourceEpisode) {
      throw new ApiError('NOT_FOUND', {
        code: 'WORKFLOW_LAB_SOURCE_EPISODE_NOT_FOUND',
        message: 'source episode not found',
      })
    }

    const episodeMax = await tx.projectEpisode.aggregate({
      where: { projectId: params.projectId },
      _max: { episodeNumber: true },
    })
    const nextEpisodeNumber = (episodeMax._max.episodeNumber ?? 0) + 1
    const trimmedName = params.name?.trim() ?? ''
    const forkName = trimmedName || buildForkEpisodeName({
      sourceName: sourceEpisode.name,
      sourceStage: sourceWorkflow.stage,
    })

    const forkedEpisode = await tx.projectEpisode.create({
      data: {
        projectId: params.projectId,
        episodeNumber: nextEpisodeNumber,
        name: forkName,
        description: sourceEpisode.description,
        novelText: sourceEpisode.novelText,
        audioUrl: sourceEpisode.audioUrl,
        audioMediaId: sourceEpisode.audioMediaId,
        srtContent: sourceEpisode.srtContent,
      },
      select: {
        id: true,
        name: true,
        episodeNumber: true,
      },
    })

    await cloneEpisodeProjectData({
      tx,
      sourceEpisodeId: sourceEpisode.id,
      targetEpisodeId: forkedEpisode.id,
      projectId: params.projectId,
    })

    await tx.project.update({
      where: { id: params.projectId },
      data: { lastEpisodeId: forkedEpisode.id },
    })

    return {
      sourceEpisode: {
        id: sourceEpisode.id,
        name: sourceEpisode.name,
        episodeNumber: sourceEpisode.episodeNumber,
      },
      forkedEpisode,
    }
  }, {
    timeout: 30_000,
  })

  const [forkedWorkflow, sourceWorkflowAfterFork] = await Promise.all([
    resolveEditFirstWorkflowState({
      projectId: params.projectId,
      userId: params.userId,
      episodeId: result.forkedEpisode.id,
    }),
    resolveEditFirstWorkflowState({
      projectId: params.projectId,
      userId: params.userId,
      episodeId: result.sourceEpisode.id,
    }),
  ])

  return {
    sourceEpisode: summarizeEpisode(result.sourceEpisode, sourceWorkflowAfterFork),
    forkedEpisode: summarizeEpisode(result.forkedEpisode, forkedWorkflow),
  }
}
