import { logError as _ulogError } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { attachMediaFieldsToProject } from '@/lib/media/attach'
import type { MediaRef } from '@/lib/media/types'
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

type MediaObjectRow = {
  id: string
  publicId: string
  storageKey: string
  sha256: string | null
  mimeType: string | null
  sizeBytes: bigint | number | null
  width: number | null
  height: number | null
  durationMs: number | null
  updatedAt: Date
}

type EpisodeWithPanelMediaFields = {
  storyboards?: Array<{
    panels?: Array<Record<string, unknown>>
  }>
}

function mediaUrl(publicId: string): string {
  return `/m/${encodeURIComponent(publicId)}`
}

function mapMediaObjectToRef(row: MediaObjectRow): MediaRef {
  return {
    id: row.id,
    publicId: row.publicId,
    url: mediaUrl(row.publicId),
    sha256: row.sha256,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes == null ? null : Number(row.sizeBytes),
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    updatedAt: row.updatedAt.toISOString(),
    storageKey: row.storageKey,
  }
}

function collectPanelMediaIds(episode: EpisodeWithPanelMediaFields): string[] {
  const ids = new Set<string>()
  const fields = [
    'imageMediaId',
    'videoMediaId',
    'lipSyncVideoMediaId',
    'sketchImageMediaId',
    'previousImageMediaId',
  ]

  for (const storyboard of episode.storyboards || []) {
    for (const panel of storyboard.panels || []) {
      for (const field of fields) {
        const value = panel[field]
        if (typeof value === 'string' && value.trim()) {
          ids.add(value)
        }
      }
    }
  }

  return Array.from(ids)
}

function parseStringArray(value: unknown): string[] {
  if (!value) return []
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.length > 0) : []
  } catch {
    return []
  }
}

async function resolveLegacyMediaUrl(value: unknown): Promise<unknown> {
  if (typeof value !== 'string' || value.length === 0 || value.startsWith('PENDING:')) return value
  const media = await resolveMediaRefFromLegacyValue(value)
  return media?.url || value
}

async function applyPanelMediaRef(panel: Record<string, unknown>, map: Map<string, MediaRef>, idField: string, refField: string, urlField: string) {
  const id = typeof panel[idField] === 'string' ? panel[idField] : ''
  const media = id ? map.get(id) || null : null
  panel[refField] = media
  if (media?.url) {
    panel[urlField] = media.url
  } else {
    panel[urlField] = await resolveLegacyMediaUrl(panel[urlField]) || null
  }
}

async function attachPanelCandidateUrls(panel: Record<string, unknown>) {
  const candidates = parseStringArray(panel.candidateImages)
  if (candidates.length === 0) return
  const resolvedCandidates = await Promise.all(candidates.map(resolveLegacyMediaUrl))
  panel.candidateImages = JSON.stringify(resolvedCandidates)
}

async function attachSelectedPanelMediaFields<T extends EpisodeWithPanelMediaFields>(episode: T): Promise<T> {
  const ids = collectPanelMediaIds(episode)

  const rows = ids.length > 0
    ? await prisma.mediaObject.findMany({
      where: { id: { in: ids } },
    }) as MediaObjectRow[]
    : []
  const mediaById = new Map(rows.map((row) => [row.id, mapMediaObjectToRef(row)]))

  for (const storyboard of episode.storyboards || []) {
    for (const panel of storyboard.panels || []) {
      await applyPanelMediaRef(panel, mediaById, 'imageMediaId', 'media', 'imageUrl')
      await applyPanelMediaRef(panel, mediaById, 'videoMediaId', 'videoMedia', 'videoUrl')
      await applyPanelMediaRef(panel, mediaById, 'lipSyncVideoMediaId', 'lipSyncVideoMedia', 'lipSyncVideoUrl')
      await applyPanelMediaRef(panel, mediaById, 'sketchImageMediaId', 'sketchImageMedia', 'sketchImageUrl')
      await applyPanelMediaRef(panel, mediaById, 'previousImageMediaId', 'previousImageMedia', 'previousImageUrl')
      await attachPanelCandidateUrls(panel)
    }
  }

  return episode
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
  void projectId
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
          panels: {
            orderBy: { panelIndex: 'asc' },
            select: {
              id: true,
              storyboardId: true,
              panelIndex: true,
              panelNumber: true,
              shotType: true,
              cameraMove: true,
              description: true,
              location: true,
              characters: true,
              props: true,
              srtSegment: true,
              srtStart: true,
              srtEnd: true,
              duration: true,
              imagePrompt: true,
              imageModel: true,
              imageUrl: true,
              imageMediaId: true,
              candidateImages: true,
              imageHistory: true,
              sketchImageUrl: true,
              sketchImageMediaId: true,
              previousImageUrl: true,
              previousImageMediaId: true,
              photographyRules: true,
              actingNotes: true,
              videoPrompt: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!episode) {
    throw new ApiError('NOT_FOUND')
  }

  const readiness = resolveEpisodeStageArtifacts(episode)
  const episodeWithSignedUrls = await attachSelectedPanelMediaFields(episode)
  const { novelText, ...visualEpisode } = episodeWithSignedUrls
  void novelText
  return {
    ...visualEpisode,
    artifactReadiness: readiness,
  }
}

async function loadVideosEpisode(projectId: string, episodeId: string) {
  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    select: {
      id: true,
      episodeNumber: true,
      name: true,
      description: true,
      createdAt: true,
      updatedAt: true,
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
  const episodeWithSignedUrls = await attachSelectedPanelMediaFields(episodeWithHistoryFlags)
  return {
    ...episodeWithSignedUrls,
    artifactReadiness: readiness,
  }
}

async function loadVoiceEpisode(episodeId: string) {
  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    select: {
      id: true,
      episodeNumber: true,
      name: true,
      description: true,
      createdAt: true,
      updatedAt: true,
      clips: {
        select: {
          id: true,
          start: true,
          end: true,
          duration: true,
          startText: true,
          endText: true,
          shotCount: true,
          summary: true,
          location: true,
          characters: true,
          props: true,
          content: true,
          screenplay: true,
        },
        orderBy: { createdAt: 'asc' },
      },
      storyboards: {
        select: {
          id: true,
          episodeId: true,
          clipId: true,
          panelCount: true,
          panels: {
            select: {
              id: true,
              storyboardId: true,
              panelIndex: true,
              panelNumber: true,
              description: true,
              srtSegment: true,
            },
            orderBy: { panelIndex: 'asc' },
          },
        },
        orderBy: { createdAt: 'asc' },
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

  return {
    ...episode,
    artifactReadiness: resolveEpisodeStageArtifacts(episode),
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
  if (profile === 'workspace-visual' || profile === 'storyboard') {
    return await loadWorkspaceVisualEpisode(projectId, episodeId)
  }
  if (profile === 'videos') {
    return await loadVideosEpisode(projectId, episodeId)
  }
  if (profile === 'voice') {
    return await loadVoiceEpisode(episodeId)
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
  _request: NextRequest,
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
