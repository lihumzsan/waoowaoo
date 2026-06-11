import { NextRequest, NextResponse } from 'next/server'
import { getObjectStream } from '@/lib/storage'
import { getMediaObjectByPublicId } from '@/lib/media/service'

export const runtime = 'nodejs'

function buildEtag(media: { sha256?: string | null; id: string; updatedAt?: string | null }) {
  if (media.sha256) return `"${media.sha256}"`
  return `W/"media-${media.id}-${media.updatedAt || '0'}"`
}

function readErrorStatus(error: unknown): number | null {
  const statusCode = (error as { $metadata?: { httpStatusCode?: unknown } } | null)?.$metadata?.httpStatusCode
  if (typeof statusCode === 'number') return statusCode

  const code = (error as { code?: unknown; name?: unknown } | null)?.code
  if (code === 'ENOENT') return 404

  const name = (error as { name?: unknown } | null)?.name
  if (name === 'NoSuchKey' || name === 'NotFound') return 404
  if (name === 'InvalidRange') return 416

  return null
}

function storageErrorResponse(error: unknown): Response {
  const status = readErrorStatus(error)
  if (status === 404) {
    return NextResponse.json({ error: 'Media not found in storage' }, { status: 404 })
  }
  if (status === 416) {
    return NextResponse.json({ error: 'Requested range not satisfiable' }, { status: 416 })
  }
  return NextResponse.json({ error: 'Failed to fetch media' }, { status: 502 })
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ publicId: string }> },
) {
  const { publicId } = await context.params
  const media = await getMediaObjectByPublicId(publicId)

  if (!media) {
    return NextResponse.json({ error: 'Media not found' }, { status: 404 })
  }
  if (!media.storageKey) {
    return NextResponse.json({ error: 'Media storage key missing' }, { status: 500 })
  }

  const etag = buildEtag({
    id: media.id,
    sha256: media.sha256,
    updatedAt: media.updatedAt || null,
  })

  const ifNoneMatch = request.headers.get('if-none-match')
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: etag,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  }

  const range = request.headers.get('range')

  const object = await getObjectStream({
    key: media.storageKey,
    range,
  }).catch(storageErrorResponse)

  if (object instanceof Response) {
    return object
  }

  const contentType = media.mimeType || object.contentType || 'application/octet-stream'

  const headers = new Headers()
  headers.set('Content-Type', contentType)
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  headers.set('ETag', etag)
  if (object.contentLength != null) headers.set('Content-Length', String(object.contentLength))
  if (object.contentRange) headers.set('Content-Range', object.contentRange)
  if (object.acceptRanges) {
    headers.set('Accept-Ranges', object.acceptRanges)
  } else if (contentType.startsWith('video/') || contentType.startsWith('audio/')) {
    headers.set('Accept-Ranges', 'bytes')
  }

  return new Response(object.body, {
    status: object.statusCode,
    headers,
  })
}

export async function HEAD(
  request: NextRequest,
  context: { params: Promise<{ publicId: string }> },
) {
  const { publicId } = await context.params
  const media = await getMediaObjectByPublicId(publicId)
  if (!media) {
    return NextResponse.json({ error: 'Media not found' }, { status: 404 })
  }

  const etag = buildEtag({
    id: media.id,
    sha256: media.sha256,
    updatedAt: media.updatedAt || null,
  })

  const headers = new Headers()
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  headers.set('ETag', etag)
  if (media.mimeType) headers.set('Content-Type', media.mimeType)
  if (media.sizeBytes != null) headers.set('Content-Length', String(media.sizeBytes))
  return new Response(null, { status: 200, headers })
}
