import { NextRequest, NextResponse } from 'next/server'
import { getSignedObjectUrl } from '@/lib/storage'
import { authorizeMediaObjectRead } from '@/lib/media/storage-access-policy'
import { apiHandler } from '@/lib/api-errors'

export const runtime = 'nodejs'

/**
 * The redirect must expire before the signed URL. `private` keeps shared/CDN
 * caches out, so this route remains the only authorization gate while the
 * browser downloads immutable bytes directly from object storage.
 */
const MEDIA_SIGNED_URL_EXPIRES_SECONDS = 60 * 60
const MEDIA_CACHE_MAX_AGE_SECONDS = 55 * 60
const MEDIA_CACHE_CONTROL = `private, max-age=${MEDIA_CACHE_MAX_AGE_SECONDS}, immutable`

function buildEtag(media: { sha256?: string | null; id: string; updatedAt?: string | Date | null }) {
  if (media.sha256) return `"${media.sha256}"`
  return `W/"media-${media.id}-${media.updatedAt || '0'}"`
}

export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ publicId: string }> },
) => {
  const { publicId } = await context.params
  const authorization = await authorizeMediaObjectRead(publicId)
  if (authorization instanceof Response) return authorization
  const { media } = authorization
  if (!media.storageKey) {
    return NextResponse.json({ error: 'Media storage key missing' }, { status: 500 })
  }

  const signedUrl = await getSignedObjectUrl(media.storageKey, {
    expiresInSeconds: MEDIA_SIGNED_URL_EXPIRES_SECONDS,
    responseCacheControl: MEDIA_CACHE_CONTROL,
  })

  return new NextResponse(null, {
    status: 307,
    headers: {
      Location: signedUrl,
      'Cache-Control': MEDIA_CACHE_CONTROL,
    },
  })
})

export const HEAD = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ publicId: string }> },
) => {
  const { publicId } = await context.params
  const authorization = await authorizeMediaObjectRead(publicId)
  if (authorization instanceof Response) return authorization
  const { media } = authorization

  const etag = buildEtag({
    id: media.id,
    sha256: media.sha256,
    updatedAt: media.updatedAt || null,
  })

  const headers = new Headers()
  headers.set('Cache-Control', MEDIA_CACHE_CONTROL)
  headers.set('ETag', etag)
  if (media.mimeType) headers.set('Content-Type', media.mimeType)
  if (media.sizeBytes != null) headers.set('Content-Length', String(media.sizeBytes))
  return new Response(null, { status: 200, headers })
})
