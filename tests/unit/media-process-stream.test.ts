import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateUniqueKey, toFetchableUrl, uploadObjectStream } from '@/lib/storage'
import { processRemoteMediaStream } from '@/lib/media-process'

vi.mock('@/lib/storage', () => ({
  generateUniqueKey: vi.fn(),
  toFetchableUrl: vi.fn(),
  uploadObject: vi.fn(),
  uploadObjectStream: vi.fn(),
}))

const generateUniqueKeyMock = vi.mocked(generateUniqueKey)
const toFetchableUrlMock = vi.mocked(toFetchableUrl)
const uploadObjectStreamMock = vi.mocked(uploadObjectStream)

function buildBody(bytes: number[], close = true) {
  let cancelCount = 0
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes))
      if (close) controller.close()
    },
    cancel() {
      cancelCount += 1
    },
  })
  return {
    body,
    getCancelCount: () => cancelCount,
  }
}

describe('processRemoteMediaStream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    generateUniqueKeyMock.mockReturnValue('video/panel-video-panel-1.mp4')
    toFetchableUrlMock.mockImplementation((value) => value)
  })

  it('streams a remote video to storage without materializing an ArrayBuffer', async () => {
    const source = buildBody([1, 2, 3])
    const response = new Response(source.body, {
      status: 200,
      headers: {
        'Content-Length': '3',
        'Content-Type': 'video/mp4',
      },
    })
    const arrayBufferSpy = vi.spyOn(response, 'arrayBuffer')
    const fetchMock = vi.fn(async () => response)
    vi.stubGlobal('fetch', fetchMock)
    uploadObjectStreamMock.mockImplementation(async (body) => {
      expect(Array.from(new Uint8Array(await new Response(body).arrayBuffer()))).toEqual([1, 2, 3])
      return 'video/panel-video-panel-1.mp4'
    })

    const result = await processRemoteMediaStream({
      source: 'https://comfy.example/view?filename=generated.mp4&type=output',
      type: 'video',
      keyPrefix: 'panel-video',
      targetId: 'panel-1',
      contentLength: 3,
      mimeType: 'video/mp4',
    })

    expect(result).toBe('video/panel-video-panel-1.mp4')
    expect(uploadObjectStreamMock).toHaveBeenCalledWith(
      expect.any(ReadableStream),
      'video/panel-video-panel-1.mp4',
      3,
      'video/mp4',
    )
    expect(arrayBufferSpy).not.toHaveBeenCalled()
    expect(source.getCancelCount()).toBe(0)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://comfy.example/view?filename=generated.mp4&type=output',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('rejects a missing response length before starting storage upload', async () => {
    const source = buildBody([1, 2, 3], false)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(source.body, {
      status: 200,
      headers: { 'Content-Type': 'video/mp4' },
    })))

    await expect(processRemoteMediaStream({
      source: 'https://comfy.example/view?filename=generated.mp4&type=output',
      type: 'video',
      keyPrefix: 'panel-video',
      targetId: 'panel-1',
      mimeType: 'video/mp4',
    })).rejects.toThrow('REMOTE_MEDIA_STREAM_CONTENT_LENGTH_MISSING')

    expect(uploadObjectStreamMock).not.toHaveBeenCalled()
    expect(source.getCancelCount()).toBe(1)
  })

  it('uses the ComfyUI preflight length when the streaming response omits it', async () => {
    const source = buildBody([1, 2, 3])
    vi.stubGlobal('fetch', vi.fn(async () => new Response(source.body, {
      status: 200,
      headers: { 'Content-Type': 'application/octet-stream' },
    })))
    uploadObjectStreamMock.mockResolvedValue('video/panel-video-panel-1.mp4')

    await processRemoteMediaStream({
      source: 'https://comfy.example/view?filename=generated.mp4&type=output',
      type: 'video',
      keyPrefix: 'panel-video',
      targetId: 'panel-1',
      contentLength: 3,
      mimeType: 'video/mp4',
    })

    expect(uploadObjectStreamMock).toHaveBeenCalledWith(
      expect.any(ReadableStream),
      'video/panel-video-panel-1.mp4',
      3,
      'video/mp4',
    )
  })

  it.each([
    ['invalid', 'not-a-number', 3, 'REMOTE_MEDIA_STREAM_CONTENT_LENGTH_INVALID'],
    ['mismatched', '4', 3, 'REMOTE_MEDIA_STREAM_CONTENT_LENGTH_MISMATCH'],
  ])('rejects a %s response length before storage upload', async (_label, responseLength, expectedLength, errorCode) => {
    const source = buildBody([1, 2, 3], false)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(source.body, {
      status: 200,
      headers: {
        'Content-Length': responseLength,
        'Content-Type': 'video/mp4',
      },
    })))

    await expect(processRemoteMediaStream({
      source: 'https://comfy.example/view?filename=generated.mp4&type=output',
      type: 'video',
      keyPrefix: 'panel-video',
      targetId: 'panel-1',
      contentLength: expectedLength,
      mimeType: 'video/mp4',
    })).rejects.toThrow(errorCode)

    expect(uploadObjectStreamMock).not.toHaveBeenCalled()
    expect(source.getCancelCount()).toBe(1)
  })

  it('rejects an HTTP 200 response whose content type is not video', async () => {
    const source = buildBody([1, 2, 3], false)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(source.body, {
      status: 200,
      headers: {
        'Content-Length': '3',
        'Content-Type': 'text/html',
      },
    })))

    await expect(processRemoteMediaStream({
      source: 'https://comfy.example/view?filename=generated.mp4&type=output',
      type: 'video',
      keyPrefix: 'panel-video',
      targetId: 'panel-1',
      contentLength: 3,
      mimeType: 'video/mp4',
    })).rejects.toThrow('REMOTE_MEDIA_STREAM_MIME_INVALID')

    expect(uploadObjectStreamMock).not.toHaveBeenCalled()
    expect(source.getCancelCount()).toBe(1)
  })

  it('cancels the response body when storage rejects the stream', async () => {
    const source = buildBody([1, 2, 3], false)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(source.body, {
      status: 200,
      headers: {
        'Content-Length': '3',
        'Content-Type': 'video/mp4',
      },
    })))
    uploadObjectStreamMock.mockRejectedValue(new Error('storage failed'))

    await expect(processRemoteMediaStream({
      source: 'https://comfy.example/view?filename=generated.mp4&type=output',
      type: 'video',
      keyPrefix: 'panel-video',
      targetId: 'panel-1',
      contentLength: 3,
      mimeType: 'video/mp4',
    })).rejects.toThrow('storage failed')

    expect(source.getCancelCount()).toBe(1)
  })
})
