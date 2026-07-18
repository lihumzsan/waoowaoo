import type { Prisma } from '@prisma/client'
import type { NextResponse } from 'next/server'
import { ApiError } from '@/lib/api-errors'
import { requireUserAuth, isErrorResponse, type AuthSession } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { extractStorageKeyFromLegacyValue } from './service'

const mediaReadSelect = {
  id: true,
  publicId: true,
  storageKey: true,
  sha256: true,
  mimeType: true,
  sizeBytes: true,
  width: true,
  height: true,
  durationMs: true,
  updatedAt: true,
} satisfies Prisma.MediaObjectSelect

export type AuthorizedMediaObject = Prisma.MediaObjectGetPayload<{ select: typeof mediaReadSelect }>

export type AuthorizedMediaRead = {
  session: AuthSession
  media: AuthorizedMediaObject
}

function normalizeStorageKey(key: string): string {
  const trimmed = key.trim()
  const normalized = trimmed.replace(/^\/+/, '')
  if (!normalized || trimmed.startsWith('/') || normalized.includes('..') || normalized.includes('\\')) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'STORAGE_KEY_INVALID',
      field: 'key',
    })
  }
  return normalized
}

function ownedMediaRelations(userId: string): Prisma.MediaObjectWhereInput[] {
  return [
    { characterAppearanceImages: { some: { character: { project: { userId } } } } },
    { locationImages: { some: { location: { project: { userId } } } } },
    { projectEpisodeAudios: { some: { project: { userId } } } },
    { projectEpisodeSourceDocumentRawFiles: { some: { episode: { project: { userId } } } } },
    { projectEditChapterOutputVideos: { some: { episode: { project: { userId } } } } },
    { projectVideoSegmentVideos: { some: { project: { userId } } } },
    { projectEpisodeFinalOutputVideos: { some: { episode: { project: { userId } } } } },
    { globalCharacterAppearanceImages: { some: { character: { userId } } } },
    { globalCharacterAppearancePreviousImgs: { some: { character: { userId } } } },
    { globalLocationImageImages: { some: { location: { userId } } } },
    { globalLocationImagePreviousImages: { some: { location: { userId } } } },
    { creativeResourceRevisions: { some: { resource: { userId } } } },
  ]
}

function legacyValueReferencesKey(value: string | null, storageKey: string): boolean {
  if (!value) return false
  const direct = extractStorageKeyFromLegacyValue(value)
  if (direct === storageKey) return true
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) && parsed.some((item) =>
      typeof item === 'string' && extractStorageKeyFromLegacyValue(item) === storageKey)
  } catch {
    return false
  }
}

async function hasOwnedLegacyReference(userId: string, storageKey: string): Promise<boolean> {
  const [
    projectAppearances,
    projectLocationImages,
    projectEpisodes,
    finalOutputs,
    stylePreviews,
    globalAppearances,
    globalLocationImages,
  ] = await Promise.all([
    prisma.characterAppearance.findMany({
      where: {
        character: { project: { userId } },
        OR: [
          { imageUrl: { contains: storageKey } },
          { imageUrls: { contains: storageKey } },
          { previousImageUrl: { contains: storageKey } },
          { previousImageUrls: { contains: storageKey } },
        ],
      },
      select: { imageUrl: true, imageUrls: true, previousImageUrl: true, previousImageUrls: true },
    }),
    prisma.locationImage.findMany({
      where: {
        location: { project: { userId } },
        OR: [
          { imageUrl: { contains: storageKey } },
          { previousImageUrl: { contains: storageKey } },
        ],
      },
      select: { imageUrl: true, previousImageUrl: true },
    }),
    prisma.projectEpisode.findMany({
      where: { project: { userId }, audioUrl: { contains: storageKey } },
      select: { audioUrl: true },
    }),
    prisma.projectEpisodeFinalOutput.findMany({
      where: { episode: { project: { userId } }, outputUrl: { contains: storageKey } },
      select: { outputUrl: true },
    }),
    prisma.projectEditStylePreview.findMany({
      where: { project: { userId }, imageKey: storageKey },
      select: { imageKey: true },
    }),
    prisma.globalCharacterAppearance.findMany({
      where: {
        character: { userId },
        OR: [
          { imageUrl: { contains: storageKey } },
          { imageUrls: { contains: storageKey } },
          { previousImageUrl: { contains: storageKey } },
          { previousImageUrls: { contains: storageKey } },
        ],
      },
      select: { imageUrl: true, imageUrls: true, previousImageUrl: true, previousImageUrls: true },
    }),
    prisma.globalLocationImage.findMany({
      where: {
        location: { userId },
        OR: [
          { imageUrl: { contains: storageKey } },
          { previousImageUrl: { contains: storageKey } },
        ],
      },
      select: { imageUrl: true, previousImageUrl: true },
    }),
  ])

  return [
    ...projectAppearances.flatMap((row) => [row.imageUrl, row.imageUrls, row.previousImageUrl, row.previousImageUrls]),
    ...projectLocationImages.flatMap((row) => [row.imageUrl, row.previousImageUrl]),
    ...projectEpisodes.map((row) => row.audioUrl),
    ...finalOutputs.map((row) => row.outputUrl),
    ...stylePreviews.map((row) => row.imageKey),
    ...globalAppearances.flatMap((row) => [row.imageUrl, row.imageUrls, row.previousImageUrl, row.previousImageUrls]),
    ...globalLocationImages.flatMap((row) => [row.imageUrl, row.previousImageUrl]),
  ].some((value) => legacyValueReferencesKey(value, storageKey))
}

async function requireOwnedMediaObject(input: {
  userId: string
  publicId?: string
  storageKey?: string
}): Promise<AuthorizedMediaObject> {
  const selector: Prisma.MediaObjectWhereInput = input.publicId
    ? { publicId: input.publicId }
    : { storageKey: input.storageKey }
  const media = await prisma.mediaObject.findFirst({
    where: {
      ...selector,
      OR: ownedMediaRelations(input.userId),
    },
    select: mediaReadSelect,
  })
  if (media) return media

  const unscoped = await prisma.mediaObject.findFirst({ where: selector, select: mediaReadSelect })
  if (
    unscoped
    && await hasOwnedLegacyReference(input.userId, unscoped.storageKey)
  ) {
    return unscoped
  }
  throw new ApiError('NOT_FOUND', { code: 'MEDIA_NOT_FOUND' })
}

async function requireSession(): Promise<AuthSession | NextResponse> {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  return authResult.session
}

export async function authorizeStorageObjectRead(key: string): Promise<AuthorizedMediaRead | NextResponse> {
  const session = await requireSession()
  if (session instanceof Response) return session
  const media = await authorizeStorageObjectReadForUser(key, session.user.id)
  return { session, media }
}

/**
 * 后台任务读取媒体时使用的唯一入口。调用方必须传入任务的权威 userId，
 * 且读取仍由与 HTTP 媒体路由相同的关系所有权策略裁决。
 */
export async function authorizeStorageObjectReadForUser(
  key: string,
  userId: string,
): Promise<AuthorizedMediaObject> {
  const storageKey = normalizeStorageKey(key)
  const normalizedUserId = userId.trim()
  if (!normalizedUserId) throw new ApiError('UNAUTHORIZED', { code: 'USER_ID_REQUIRED' })
  return await requireOwnedMediaObject({ userId: normalizedUserId, storageKey })
}

export async function authorizeMediaObjectRead(publicId: string): Promise<AuthorizedMediaRead | NextResponse> {
  const normalizedPublicId = publicId.trim()
  if (!normalizedPublicId) throw new ApiError('NOT_FOUND', { code: 'MEDIA_NOT_FOUND' })
  const session = await requireSession()
  if (session instanceof Response) return session
  const media = await requireOwnedMediaObject({ userId: session.user.id, publicId: normalizedPublicId })
  return { session, media }
}
