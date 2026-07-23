import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { addSignedUrlsToProject } from '@/lib/storage'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
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
}> {
  const keys: string[] = []

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
          storyboards: {
            include: { panels: true },
          },
        },
      },
    },
  })

  if (!novelPromotion) return { keys }

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
    `[Project ${projectId}] collected ${keys.length} COS object keys for cleanup review`,
  )
  return { keys }
}

// DELETE - remove project data and retain media while legacy references are incomplete.
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
  const { keys: cosKeys } = await collectProjectCOSKeys(projectId)
  const uniqueCosKeys = [...new Set(cosKeys)]

  const coverMedia = await prisma.$transaction(async (tx) => {
    const episodes = await tx.novelPromotionEpisode.findMany({
      where: { novelPromotionProject: { projectId } },
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
    for (const episode of episodes) {
      if (!episode.coverImageMediaId || coversById.has(episode.coverImageMediaId)) continue
      coversById.set(episode.coverImageMediaId, {
        id: episode.coverImageMediaId,
        episodeId: episode.id,
        storageKey: episode.coverImageMedia?.storageKey,
      })
    }

    await tx.project.delete({
      where: { id: projectId },
    })
    return [...coversById.values()]
  }, { isolationLevel: 'Serializable' })

  const skippedStorageKeys = new Set(uniqueCosKeys)
  for (const media of coverMedia) {
    if (media.storageKey) skippedStorageKeys.add(media.storageKey)
  }
  if (skippedStorageKeys.size > 0 || coverMedia.length > 0) {
    _ulogInfo(
      '[DELETE] skipped project media cleanup because legacy reference inventory is incomplete',
      {
        projectId,
        skippedStorageKeyCount: skippedStorageKeys.size,
        skippedMediaCount: coverMedia.length,
      },
    )
  }

  const cosResult = { success: 0, failed: 0 }

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
