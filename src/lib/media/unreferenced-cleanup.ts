import { prisma } from '@/lib/prisma'
import { deleteObject } from '@/lib/storage'

export type UnreferencedMediaCleanupResult = 'deleted' | 'referenced' | 'missing'

export class MediaOrphanCleanupError extends Error {
  readonly code = 'MEDIA_ORPHAN_STORAGE_CLEANUP_FAILED'
  readonly mediaId: string
  readonly storageKey: string
  override readonly cause: unknown

  constructor(mediaId: string, storageKey: string, cause: unknown) {
    super(`Media storage cleanup failed for ${storageKey}`)
    this.name = 'MediaOrphanCleanupError'
    this.mediaId = mediaId
    this.storageKey = storageKey
    this.cause = cause
  }
}

export async function deleteMediaObjectIfUnreferenced(
  mediaId: string,
): Promise<UnreferencedMediaCleanupResult> {
  const claim = await prisma.$transaction(async (tx) => {
    const media = await tx.mediaObject.findUnique({
      where: { id: mediaId },
      select: { storageKey: true, _count: true },
    })
    if (!media) return { result: 'missing' as const }

    if (Object.values(media._count).some((count) => count > 0)) {
      return { result: 'referenced' as const }
    }

    await tx.mediaObject.delete({ where: { id: mediaId } })
    return {
      result: 'deleted' as const,
      storageKey: media.storageKey,
    }
  }, { isolationLevel: 'Serializable' })

  if (claim.result !== 'deleted') return claim.result

  try {
    await deleteObject(claim.storageKey)
  } catch (cause) {
    throw new MediaOrphanCleanupError(mediaId, claim.storageKey, cause)
  }

  return 'deleted'
}
