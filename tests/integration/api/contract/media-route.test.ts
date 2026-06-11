import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ObjectStreamResult } from '@/lib/storage/types'

const mediaMock = vi.hoisted(() => ({
  getMediaObjectByPublicId: vi.fn(),
}))

const storageMock = vi.hoisted(() => ({
  getObjectStream: vi.fn(),
}))

vi.mock('@/lib/media/service', () => mediaMock)
vi.mock('@/lib/storage', () => storageMock)

function streamFromText(value: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value))
      controller.close()
    },
  })
}

function objectStream(overrides: Partial<ObjectStreamResult> = {}): ObjectStreamResult {
  return {
    body: streamFromText('jpeg-bytes'),
    contentType: 'image/jpeg',
    contentLength: 10,
    contentRange: null,
    acceptRanges: 'bytes',
    statusCode: 200,
    ...overrides,
  }
}

function request(headers?: HeadersInit): NextRequest {
  return new NextRequest('http://localhost:3000/m/media-public-id', {
    method: 'GET',
    headers,
  })
}

function context(publicId = 'media-public-id') {
  return {
    params: Promise.resolve({ publicId }),
  }
}

describe('media route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mediaMock.getMediaObjectByPublicId.mockResolvedValue({
      id: 'media-row-1',
      publicId: 'media-public-id',
      storageKey: 'images/source.jpg',
      sha256: 'hash-1',
      mimeType: 'image/jpeg',
      sizeBytes: null,
      width: null,
      height: null,
      durationMs: null,
      updatedAt: '2026-06-11T00:00:00.000Z',
      url: '/m/media-public-id',
    })
    storageMock.getObjectStream.mockResolvedValue(objectStream())
    vi.stubGlobal('fetch', vi.fn())
  })

  it('streams media object bytes directly from storage without calling sign route', async () => {
    const { GET } = await import('@/app/m/[publicId]/route')

    const response = await GET(request(), context())

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(response.headers.get('content-length')).toBe('10')
    expect(response.headers.get('etag')).toBe('"hash-1"')
    expect(await response.text()).toBe('jpeg-bytes')
    expect(storageMock.getObjectStream.mock.calls).toEqual([
      [{ key: 'images/source.jpg', range: null }],
    ])
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0)
  })

  it('passes range requests to storage and returns partial content headers', async () => {
    storageMock.getObjectStream.mockResolvedValue(objectStream({
      body: streamFromText('part'),
      contentLength: 4,
      contentRange: 'bytes 0-3/10',
      statusCode: 206,
    }))
    const { GET } = await import('@/app/m/[publicId]/route')

    const response = await GET(request({ range: 'bytes=0-3' }), context())

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 0-3/10')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(await response.text()).toBe('part')
    expect(storageMock.getObjectStream.mock.calls).toEqual([
      [{ key: 'images/source.jpg', range: 'bytes=0-3' }],
    ])
  })

  it('returns explicit 404 when the storage object is missing', async () => {
    const missingError = Object.assign(new Error('missing'), { name: 'NoSuchKey' })
    storageMock.getObjectStream.mockRejectedValue(missingError)
    const { GET } = await import('@/app/m/[publicId]/route')

    const response = await GET(request(), context())
    const body = await response.json() as { error: string }

    expect(response.status).toBe(404)
    expect(body.error).toBe('Media not found in storage')
  })
})
