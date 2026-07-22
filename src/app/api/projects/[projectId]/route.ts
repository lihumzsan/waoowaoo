import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { addSignedUrlsToProject, deleteObjects } from '@/lib/storage'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import {
  deleteMediaObjectIfUnreferenced,
  MediaOrphanCleanupError,
} from '@/lib/media/unreferenced-cleanup'
import { logProjectAction } from '@/lib/logging/semantic'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

// GET - return base project details. Mode-specific data is loaded from its own API.
export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { user: true },
  })

  if (!project) {
    throw new ApiError('NOT_FOUND')
  }

  if (project.userId !== session.user.id) {
    throw new ApiError('FORBIDDEN')
  }

  // Update access time asynchronously without blocking the response.
  prisma.project.update({
    where: { id: projectId },
    data: { lastAccessedAt: new Date() },
  }).catch((err) => _ulogError('Failed to update project access time:', err))

  return NextResponse.json({ project: addSignedUrlsToProject(project) })
})

// PATCH - update base project configuration.
export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const session = authResult.session
  const body = await request.json()

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { user: true },
  })

  if (!project) {
    throw new ApiError('NOT_FOUND')
  }

  if (project.userId !== session.user.id) {
    throw new ApiError('FORBIDDEN')
  }

  const updatedProject = await prisma.project.update({
    where: { id: projectId },
    data: body,
  })

  logProjectAction(
    'UPDATE',
    session.user.id,
    session.user.name,
    projectId,
    updatedProject.name,
    { changes: body },
  )

  return NextResponse.json({ project: updatedProject })
})

async function collectProjectCOSKeys(projectId: string): Promise<{
  keys: string[]
  coverMedia: Array<{ id: string; storageKey: string }>
}> {
  const keys: string[] = []
  const coverMediaById = new Map<string, { id: string; storageKey: string }>()

  const novelPromotion = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    include: {
      characters: {
        include: { appearances: true },
      },
      locations: {
        include: { images: true },
      },
      freeVoiceRecords: {
        include: { versions: true },
      },
      episodes: {
        include: {
          coverImageMedia: {
            select: { id: true, storageKey: true },
          },
          storyboards: {
            include: { panels: true },
          },
        },
      },
    },
  })

  if (!novelPromotion) return { keys, coverMedia: [] }

  for (const character of novelPromotion.characters) {
    for (const appearance of character.appearances) {
      const key = await resolveStorageKeyFromMediaValue(appearance.imageUrl)
      if (key) keys.push(key)
    }
  }

  for (const location of novelPromotion.locations) {
    for (const image of location.images) {
      const key = await resolveStorageKeyFromMediaValue(image.imageUrl)
      if (key) keys.push(key)
    }
  }

  for (const record of novelPromotion.freeVoiceRecords) {
    for (const version of record.versions) {
      const key = await resolveStorageKeyFromMediaValue(version.audioUrl)
      if (key) keys.push(key)
    }
  }

  for (const episode of novelPromotion.episodes) {
    if (episode.coverImageMedia) {
      coverMediaById.set(episode.coverImageMedia.id, episode.coverImageMedia)
    }
    const audioKey = await resolveStorageKeyFromMediaValue(episode.audioUrl)
    if (audioKey) keys.push(audioKey)

    for (const storyboard of episode.storyboards) {
      const storyboardKey = await resolveStorageKeyFromMediaValue(storyboard.storyboardImageUrl)
      if (storyboardKey) keys.push(storyboardKey)

      if (storyboard.candidateImages) {
        try {
          const candidates = JSON.parse(storyboard.candidateImages)
          if (Array.isArray(candidates)) {
            for (const url of candidates) {
              const key = await resolveStorageKeyFromMediaValue(url)
              if (key) keys.push(key)
            }
          }
        } catch {
          // Ignore malformed historical candidate image payloads during deletion cleanup.
        }
      }

      for (const panel of storyboard.panels) {
        const imageKey = await resolveStorageKeyFromMediaValue(panel.imageUrl)
        if (imageKey) keys.push(imageKey)

        const videoKey = await resolveStorageKeyFromMediaValue(panel.videoUrl)
        if (videoKey) keys.push(videoKey)
      }
    }
  }

  _ulogInfo(
    `[Project ${projectId}] collected ${keys.length} COS object keys and ${coverMediaById.size} Episode covers for deletion`,
  )
  return { keys, coverMedia: [...coverMediaById.values()] }
}

// DELETE - remove project data and related COS objects.
export const DELETE = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const session = authResult.session

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { user: true },
  })

  if (!project) {
    throw new ApiError('NOT_FOUND')
  }

  if (project.userId !== session.user.id) {
    throw new ApiError('FORBIDDEN')
  }

  _ulogInfo(`[DELETE] deleting project ${project.name} (${projectId})`)
  const { keys: cosKeys, coverMedia } = await collectProjectCOSKeys(projectId)

  let cosResult = { success: 0, failed: 0 }
  if (cosKeys.length > 0) {
    _ulogInfo(`[DELETE] deleting ${cosKeys.length} COS objects`)
    cosResult = await deleteObjects(cosKeys)
  }

  await prisma.project.delete({
    where: { id: projectId },
  })

  for (const media of coverMedia) {
    try {
      const cleanupResult = await deleteMediaObjectIfUnreferenced(media.id)
      if (cleanupResult === 'deleted') cosResult.success += 1
    } catch (error) {
      if (!(error instanceof MediaOrphanCleanupError)) throw error
      cosResult.failed += 1
      _ulogError('Episode cover storage cleanup failed after project deletion', {
        projectId,
        mediaId: media.id,
        storageKey: error.storageKey || media.storageKey,
      })
    }
  }

  logProjectAction(
    'DELETE',
    session.user.id,
    session.user.name,
    projectId,
    project.name,
    {
      projectName: project.name,
      cosFilesDeleted: cosResult.success,
      cosFilesFailed: cosResult.failed,
    },
  )

  _ulogInfo(`[DELETE] project deleted: ${project.name}`)
  _ulogInfo(`[DELETE] COS objects: success ${cosResult.success}, failed ${cosResult.failed}`)

  return NextResponse.json({
    success: true,
    cosFilesDeleted: cosResult.success,
    cosFilesFailed: cosResult.failed,
  })
})
