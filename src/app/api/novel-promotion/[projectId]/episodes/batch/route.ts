import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { logError as _ulogError } from '@/lib/logging/core'
import { deleteMediaObjectIfUnreferenced } from '@/lib/media/unreferenced-cleanup'

type BatchSaveMode = 'append' | 'update_current' | 'replace_all'

interface BatchEpisode {
  name: string
  description?: string | null
  novelText: string
}

function readSaveMode(body: Record<string, unknown>): BatchSaveMode {
  if (body.mode === 'append' || body.mode === 'update_current' || body.mode === 'replace_all') {
    return body.mode
  }

  // Backward compatibility only. Replacement still needs explicit confirmation below.
  if (body.clearExisting === true) {
    return 'replace_all'
  }

  return 'append'
}

function normalizeEpisode(input: unknown, index: number): BatchEpisode {
  if (!input || typeof input !== 'object') {
    throw new ApiError('INVALID_PARAMS', { message: `Invalid episode at index ${index}` })
  }

  const episode = input as Record<string, unknown>
  const fallbackName = `Episode ${index + 1}`
  const name = typeof episode.name === 'string' && episode.name.trim() ? episode.name.trim() : fallbackName
  const description = typeof episode.description === 'string' ? episode.description : null
  const novelText = typeof episode.novelText === 'string' ? episode.novelText : ''

  return {
    name,
    description,
    novelText,
  }
}

function normalizeImportStatus(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function mapEpisodeResponse(ep: { id: string; episodeNumber: number; name: string }) {
  return {
    id: ep.id,
    episodeNumber: ep.episodeNumber,
    name: ep.name,
  }
}

async function countEpisodeDependents(novelPromotionProjectId: string) {
  const existingEpisodes = await prisma.novelPromotionEpisode.findMany({
    where: { novelPromotionProjectId },
    select: { id: true, coverImageMediaId: true },
  })
  const episodeIds = existingEpisodes.map((episode) => episode.id)
  if (episodeIds.length === 0) {
    return {
      covers: 0,
      clips: 0,
      shots: 0,
      storyboards: 0,
      panels: 0,
      voiceLines: 0,
    }
  }

  const [clips, shots, storyboards, panels, voiceLines] = await Promise.all([
    prisma.novelPromotionClip.count({ where: { episodeId: { in: episodeIds } } }),
    prisma.novelPromotionShot.count({ where: { episodeId: { in: episodeIds } } }),
    prisma.novelPromotionStoryboard.count({ where: { episodeId: { in: episodeIds } } }),
    prisma.novelPromotionPanel.count({
      where: {
        storyboard: {
          episodeId: { in: episodeIds },
        },
      },
    }),
    prisma.novelPromotionVoiceLine.count({ where: { episodeId: { in: episodeIds } } }),
  ])

  return {
    covers: existingEpisodes.filter((episode) => !!episode.coverImageMediaId).length,
    clips,
    shots,
    storyboards,
    panels,
    voiceLines,
  }
}

export const POST = apiHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const rawEpisodes = Array.isArray(body.episodes) ? body.episodes : null
  if (!rawEpisodes) {
    throw new ApiError('INVALID_PARAMS')
  }

  const mode = readSaveMode(body)
  const confirmReplace = body.confirmReplace === true
  const confirmCascadeDelete = body.confirmCascadeDelete === true
  const importStatus = normalizeImportStatus(body.importStatus)
  const episodes = rawEpisodes.map((episode, index) => normalizeEpisode(episode, index))

  const project = await prisma.novelPromotionProject.findFirst({
    where: { projectId },
  })

  if (!project) {
    throw new ApiError('NOT_FOUND')
  }

  if (mode === 'replace_all' && !confirmReplace) {
    throw new ApiError('INVALID_PARAMS', {
      message: 'replace_all requires confirmReplace=true',
      mode,
    })
  }

  if (mode === 'replace_all' && !confirmCascadeDelete) {
    const dependents = await countEpisodeDependents(project.id)
    const hasGeneratedContent = Object.values(dependents).some((count) => count > 0)
    if (hasGeneratedContent) {
      throw new ApiError('INVALID_PARAMS', {
        message: 'replace_all would delete existing generated content; confirmCascadeDelete=true is required',
        mode,
        dependents,
      })
    }
  }

  if (mode === 'update_current') {
    const episodeId = typeof body.episodeId === 'string' && body.episodeId.trim() ? body.episodeId.trim() : null
    if (!episodeId || episodes.length !== 1) {
      throw new ApiError('INVALID_PARAMS', {
        message: 'update_current requires one episode and episodeId',
        mode,
      })
    }

    const targetEpisode = await prisma.novelPromotionEpisode.findFirst({
      where: {
        id: episodeId,
        novelPromotionProjectId: project.id,
      },
    })
    if (!targetEpisode) {
      throw new ApiError('NOT_FOUND')
    }

    const updatedEpisode = await prisma.$transaction(async (tx) => {
      const episode = await tx.novelPromotionEpisode.update({
        where: { id: targetEpisode.id },
        data: {
          name: episodes[0].name,
          description: episodes[0].description,
          novelText: episodes[0].novelText,
        },
      })

      await tx.novelPromotionProject.update({
        where: { id: project.id },
        data: {
          lastEpisodeId: episode.id,
          ...(importStatus ? { importStatus } : {}),
        },
      })

      return episode
    })

    return NextResponse.json({
      success: true,
      mode,
      episodes: [mapEpisodeResponse(updatedEpisode)],
    })
  }

  if (mode === 'replace_all') {
    const result = await prisma.$transaction(async (tx) => {
      const replacedEpisodes = await tx.novelPromotionEpisode.findMany({
        where: { novelPromotionProjectId: project.id },
        select: {
          id: true,
          coverImageMediaId: true,
          coverImageMedia: { select: { storageKey: true } },
        },
      })
      const coversById = new Map<string, {
        id: string
        episodeId: string
        storageKey?: string
      }>()
      for (const episode of replacedEpisodes) {
        if (!episode.coverImageMediaId || coversById.has(episode.coverImageMediaId)) continue
        coversById.set(episode.coverImageMediaId, {
          id: episode.coverImageMediaId,
          episodeId: episode.id,
          storageKey: episode.coverImageMedia?.storageKey,
        })
      }

      if (!confirmCascadeDelete && coversById.size > 0) {
        throw new ApiError('INVALID_PARAMS', {
          message: 'replace_all would delete existing generated content; confirmCascadeDelete=true is required',
          mode,
          dependents: { covers: coversById.size },
        })
      }

      await tx.novelPromotionEpisode.deleteMany({
        where: { novelPromotionProjectId: project.id },
      })

      const createdEpisodes = await Promise.all(
        episodes.map((ep, index) =>
          tx.novelPromotionEpisode.create({
            data: {
              novelPromotionProjectId: project.id,
              episodeNumber: index + 1,
              name: ep.name,
              description: ep.description,
              novelText: ep.novelText,
            },
          }),
        ),
      )

      await tx.novelPromotionProject.update({
        where: { id: project.id },
        data: {
          lastEpisodeId: createdEpisodes[0]?.id ?? null,
          ...(importStatus ? { importStatus } : {}),
        },
      })

      return {
        createdEpisodes,
        replacedCount: replacedEpisodes.length,
        formerCoverMedia: [...coversById.values()],
      }
    }, { isolationLevel: 'Serializable' })

    for (const media of result.formerCoverMedia) {
      try {
        await deleteMediaObjectIfUnreferenced(media.id)
      } catch (error) {
        const cleanupStorageKey = error && typeof error === 'object' && 'storageKey' in error
          && typeof error.storageKey === 'string'
          ? error.storageKey
          : media.storageKey
        _ulogError('Episode cover cleanup failed after batch replacement', {
          projectId,
          episodeId: media.episodeId,
          mediaId: media.id,
          storageKey: cleanupStorageKey,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return NextResponse.json({
      success: true,
      mode,
      replacedCount: result.replacedCount,
      episodes: result.createdEpisodes.map(mapEpisodeResponse),
    })
  }

  const createdEpisodes = await prisma.$transaction(async (tx) => {
    const lastEpisode = await tx.novelPromotionEpisode.findFirst({
      where: { novelPromotionProjectId: project.id },
      orderBy: { episodeNumber: 'desc' },
    })
    const startNumber = (lastEpisode?.episodeNumber || 0) + 1

    const created = await Promise.all(
      episodes.map((ep, index) =>
        tx.novelPromotionEpisode.create({
          data: {
            novelPromotionProjectId: project.id,
            episodeNumber: startNumber + index,
            name: ep.name,
            description: ep.description,
            novelText: ep.novelText,
          },
        }),
      ),
    )

    if (importStatus || created[0]) {
      await tx.novelPromotionProject.update({
        where: { id: project.id },
        data: {
          ...(created[0] ? { lastEpisodeId: created[0].id } : {}),
          ...(importStatus ? { importStatus } : {}),
        },
      })
    }

    return created
  })

  return NextResponse.json({
    success: true,
    mode,
    episodes: createdEpisodes.map(mapEpisodeResponse),
  })
})
