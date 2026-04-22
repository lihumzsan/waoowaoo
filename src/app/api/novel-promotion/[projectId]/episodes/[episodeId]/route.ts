import { logError as _ulogError } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { attachMediaFieldsToProject } from '@/lib/media/attach'
import { resolveMediaRefFromLegacyValue } from '@/lib/media/service'
import {
  normalizeEpisodeDataProfile,
  type EpisodeDataProfile,
} from '@/lib/novel-promotion/episode-data-profile'
import { resolveEpisodeStageArtifacts } from '@/lib/novel-promotion/stage-readiness'
import { buildPanelPreviousVideoAvailabilityMap } from '@/lib/novel-promotion/video-restore-history'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'

type ConfigEpisodePayload = {
  id: string
  episodeNumber: number
  name: string
  novelText: string | null
  createdAt: Date
  clips: Array<{ id: string; screenplay: string | null }>
  storyboards: Array<{
    id: string
    panels: Array<{ id: string; videoUrl: string | null }>
  }>
  voiceLines: Array<{ id: string }>
}

type EpisodeWithStoryboardPanels = {
  storyboards?: Array<{
    id: string
    panels?: Array<{
      id: string
      videoUrl?: string | null
      hasPreviousVideoVersion?: boolean
    }>
  }>
}

async function attachPreviousVideoVersionFlags<T extends EpisodeWithStoryboardPanels>(
  projectId: string,
  episode: T,
): Promise<T> {
  const panels = (episode.storyboards || []).flatMap((storyboard) => storyboard.panels || [])
    .filter((panel): panel is NonNullable<typeof panel> & { id: string } => typeof panel?.id === 'string' && panel.id.length > 0)

  if (panels.length === 0) return episode

  const completedVideoTasks = await prisma.task.findMany({
    where: {
      projectId,
      type: TASK_TYPE.VIDEO_PANEL,
      status: TASK_STATUS.COMPLETED,
      targetType: 'NovelPromotionPanel',
      targetId: { in: panels.map((panel) => panel.id) },
    },
    orderBy: [
      { finishedAt: 'desc' },
      { createdAt: 'desc' },
    ],
    select: {
      id: true,
      targetId: true,
      payload: true,
      result: true,
    },
  })

  const availability = buildPanelPreviousVideoAvailabilityMap(
    panels.map((panel) => ({
      id: panel.id,
      videoUrl: panel.videoUrl ?? null,
    })),
    completedVideoTasks,
  )

  return {
    ...episode,
    storyboards: (episode.storyboards || []).map((storyboard) => ({
      ...storyboard,
      panels: (storyboard.panels || []).map((panel) => ({
        ...panel,
        hasPreviousVideoVersion: availability.get(panel.id) ?? false,
      })),
    })),
  }
}

async function loadConfigEpisode(episodeId: string) {
  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    select: {
      id: true,
      episodeNumber: true,
      name: true,
      novelText: true,
      createdAt: true,
      clips: {
        select: {
          id: true,
          screenplay: true,
        },
        where: {
          AND: [
            { screenplay: { not: null } },
            { screenplay: { not: '' } },
          ],
        },
        take: 1,
      },
      storyboards: {
        select: {
          id: true,
          panels: {
            select: {
              id: true,
              videoUrl: true,
            },
            where: {
              AND: [
                { videoUrl: { not: null } },
                { videoUrl: { not: '' } },
              ],
            },
            take: 1,
          },
        },
        where: {
          panels: {
            some: {},
          },
        },
        take: 1,
      },
      voiceLines: {
        select: { id: true },
        take: 1,
      },
    },
  })

  if (!episode) {
    throw new ApiError('NOT_FOUND')
  }

  const readiness = resolveEpisodeStageArtifacts(episode as ConfigEpisodePayload)

  return {
    id: episode.id,
    episodeNumber: episode.episodeNumber,
    name: episode.name,
    novelText: episode.novelText,
    createdAt: episode.createdAt,
    artifactReadiness: readiness,
  }
}

async function loadWorkspaceVisualEpisode(projectId: string, episodeId: string) {
  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    select: {
      id: true,
      episodeNumber: true,
      name: true,
      description: true,
      createdAt: true,
      updatedAt: true,
      novelText: true,
      clips: {
        orderBy: { createdAt: 'asc' },
      },
      storyboards: {
        include: {
          clip: true,
          panels: { orderBy: { panelIndex: 'asc' } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!episode) {
    throw new ApiError('NOT_FOUND')
  }

  const readiness = resolveEpisodeStageArtifacts(episode)
  const episodeWithHistoryFlags = await attachPreviousVideoVersionFlags(projectId, episode)
  const episodeWithSignedUrls = await attachMediaFieldsToProject(episodeWithHistoryFlags)
  const { novelText, ...visualEpisode } = episodeWithSignedUrls
  void novelText
  return {
    ...visualEpisode,
    artifactReadiness: readiness,
  }
}

async function loadFullEpisode(projectId: string, episodeId: string) {
  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    include: {
      clips: {
        orderBy: { createdAt: 'asc' }
      },
      storyboards: {
        include: {
          clip: true,
          panels: { orderBy: { panelIndex: 'asc' } }
        },
        orderBy: { createdAt: 'asc' }
      },
      shots: {
        orderBy: { shotId: 'asc' }
      },
      voiceLines: {
        orderBy: { lineIndex: 'asc' }
      }
    }
  })

  if (!episode) {
    throw new ApiError('NOT_FOUND')
  }

  const episodeWithHistoryFlags = await attachPreviousVideoVersionFlags(projectId, episode)
  const episodeWithSignedUrls = await attachMediaFieldsToProject(episodeWithHistoryFlags)
  return {
    ...episodeWithSignedUrls,
    artifactReadiness: resolveEpisodeStageArtifacts(episode),
  }
}

async function loadEpisodeByProfile(projectId: string, episodeId: string, profile: EpisodeDataProfile) {
  if (profile === 'config') {
    return await loadConfigEpisode(episodeId)
  }
  if (profile === 'workspace-visual') {
    return await loadWorkspaceVisualEpisode(projectId, episodeId)
  }
  return await loadFullEpisode(projectId, episodeId)
}

/**
 * GET - 获取单个剧集的完整数据
 */
export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; episodeId: string }> }
) => {
  const { projectId, episodeId } = await context.params
  const profile = normalizeEpisodeDataProfile(request.nextUrl.searchParams.get('profile'))

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const episode = await loadEpisodeByProfile(projectId, episodeId, profile)

  prisma.novelPromotionProject.update({
    where: { projectId },
    data: { lastEpisodeId: episodeId }
  }).catch(err => _ulogError('更新 lastEpisodeId 失败:', err))

  return NextResponse.json({ episode })
})

/**
 * PATCH - 更新剧集信息
 */
export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; episodeId: string }> }
) => {
  const { projectId, episodeId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const { name, description, novelText, audioUrl, srtContent } = body

  const updateData: Prisma.NovelPromotionEpisodeUncheckedUpdateInput = {}
  if (name !== undefined) updateData.name = name.trim()
  if (description !== undefined) updateData.description = description?.trim() || null
  if (novelText !== undefined) updateData.novelText = novelText
  if (audioUrl !== undefined) {
    updateData.audioUrl = audioUrl
    const media = await resolveMediaRefFromLegacyValue(audioUrl)
    updateData.audioMediaId = media?.id || null
  }
  if (srtContent !== undefined) updateData.srtContent = srtContent

  const episode = await prisma.novelPromotionEpisode.update({
    where: { id: episodeId },
    data: updateData
  })

  return NextResponse.json({ episode })
})

/**
 * DELETE - 删除剧集
 */
export const DELETE = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string; episodeId: string }> }
) => {
  const { projectId, episodeId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  await prisma.novelPromotionEpisode.delete({
    where: { id: episodeId }
  })

  const novelPromotionProject = await prisma.novelPromotionProject.findUnique({
    where: { projectId }
  })

  if (novelPromotionProject?.lastEpisodeId === episodeId) {
    const anotherEpisode = await prisma.novelPromotionEpisode.findFirst({
      where: { novelPromotionProjectId: novelPromotionProject.id },
      orderBy: { episodeNumber: 'asc' }
    })

    await prisma.novelPromotionProject.update({
      where: { id: novelPromotionProject.id },
      data: { lastEpisodeId: anotherEpisode?.id || null }
    })
  }

  return NextResponse.json({ success: true })
})
