import type { Prisma } from '@prisma/client'
import type { NextResponse } from 'next/server'
import { ApiError } from '@/lib/api-errors'
import { requireUserAuth, isErrorResponse, type AuthSession } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

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
    { creativeResources: { some: { userId } } },
  ]
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
