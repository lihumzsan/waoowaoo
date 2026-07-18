import { createReadStream } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Readable } from 'node:stream'
import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { authorizeStorageObjectRead } from '@/lib/media/storage-access-policy'

const UPLOAD_DIR = process.env.UPLOAD_DIR || './data/uploads'

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.json': 'application/json',
  '.txt': 'text/plain',
}

function getMimeType(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

async function requireContainedFilePath(storageKey: string): Promise<string> {
  const uploadRoot = await fs.realpath(path.resolve(process.cwd(), UPLOAD_DIR))
  const candidate = await fs.realpath(path.resolve(uploadRoot, storageKey)).catch((error: unknown) => {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? Reflect.get(error, 'code')
      : null
    if (code === 'ENOENT') throw new ApiError('NOT_FOUND', { code: 'MEDIA_NOT_FOUND' })
    throw error
  })
  if (!candidate.startsWith(`${uploadRoot}${path.sep}`)) {
    throw new ApiError('NOT_FOUND', { code: 'MEDIA_NOT_FOUND' })
  }
  return candidate
}

export const GET = apiHandler(async (
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) => {
  const { path: pathSegments } = await params
  let storageKey: string
  try {
    storageKey = decodeURIComponent(pathSegments.join('/'))
  } catch {
    throw new ApiError('INVALID_PARAMS', { code: 'STORAGE_KEY_INVALID', field: 'path' })
  }
  const authorization = await authorizeStorageObjectRead(storageKey)
  if (authorization instanceof Response) return authorization

  const filePath = await requireContainedFilePath(authorization.media.storageKey)
  const stat = await fs.stat(filePath)
  if (!stat.isFile()) throw new ApiError('NOT_FOUND', { code: 'MEDIA_NOT_FOUND' })
  const body = Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': getMimeType(filePath),
      'Content-Length': stat.size.toString(),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
})
