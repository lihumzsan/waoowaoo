import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { getSignedObjectUrl } from '@/lib/storage'
import { isErrorResponse } from '@/lib/api-auth'
import { authorizeStorageObjectRead } from '@/lib/media/storage-access-policy'

const DEFAULT_EXPIRES_SECONDS = 3600

export const GET = apiHandler(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url)
  const key = searchParams.get('key')
  const expiresRaw = searchParams.get('expires')

  if (!key) {
    throw new ApiError('INVALID_PARAMS')
  }

  const authResult = await authorizeStorageObjectRead(key)
  if (isErrorResponse(authResult)) return authResult

  const expires = expiresRaw ? Number.parseInt(expiresRaw, 10) : DEFAULT_EXPIRES_SECONDS
  const ttl = Number.isFinite(expires) && expires > 0
    ? Math.min(expires, DEFAULT_EXPIRES_SECONDS)
    : DEFAULT_EXPIRES_SECONDS

  const signedUrl = await getSignedObjectUrl(authResult.media.storageKey, {
    expiresInSeconds: ttl,
  })
  const response = new NextResponse(null, {
    status: 307,
    headers: { Location: signedUrl },
  })
  response.headers.set('Cache-Control', 'private, no-store')
  return response
})
