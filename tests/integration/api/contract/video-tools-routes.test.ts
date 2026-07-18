import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as uploadVideo } from '@/app/api/video-tools/uploads/route'
import { POST as submitSeamConcat } from '@/app/api/video-tools/seam-concat/route'
import { buildMockRequest } from '../../../helpers/request'

const authState = vi.hoisted(() => ({ authenticated: true }))
const uploadObjectStreamMock = vi.hoisted(() => vi.fn(async (body: ReadableStream<Uint8Array>, key: string) => {
  const reader = body.getReader()
  while (!(await reader.read()).done) {
    // Consume the request stream so length mismatches surface during the route call.
  }
  return key
}))
const submitTaskMock = vi.hoisted(() => vi.fn(async () => ({
  success: true,
  async: true,
  taskId: 'task-1',
  runId: 'run-1',
  status: 'queued',
  deduped: false,
})))

vi.mock('@/lib/api-auth', () => ({
  isErrorResponse: (value: unknown) => value instanceof Response,
  requireUserAuth: async () => {
    if (!authState.authenticated) {
      return new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    }
    return { session: { user: { id: 'user-1' } } }
  },
}))

vi.mock('@/lib/storage', () => ({
  uploadObjectStream: uploadObjectStreamMock,
  getSignedUrl: vi.fn((key: string) => `/api/storage/sign?key=${encodeURIComponent(key)}`),
}))

vi.mock('@/lib/task/submitter', () => ({ submitTask: submitTaskMock }))
vi.mock('@/lib/task/resolve-locale', () => ({ resolveRequiredTaskLocale: vi.fn(() => 'zh') }))

describe('video tools routes', () => {
  beforeEach(() => {
    authState.authenticated = true
    uploadObjectStreamMock.mockClear()
    submitTaskMock.mockClear()
  })

  it('streams authenticated raw MP4 bytes to a user-scoped input key', async () => {
    const request = new NextRequest('http://localhost:3000/api/video-tools/uploads', {
      method: 'POST',
      headers: {
        'content-length': '3',
        'content-type': 'video/mp4',
        'x-file-name': encodeURIComponent('shot-1-video.mp4'),
      },
      body: new Uint8Array([1, 2, 3]),
    })
    const formDataSpy = vi.spyOn(request, 'formData')
    const arrayBufferSpy = vi.spyOn(request, 'arrayBuffer')

    const response = await uploadVideo(request, { params: Promise.resolve({}) })
    const body = await response.json() as { success: boolean; key: string; name: string; size: number }

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ success: true, name: 'shot-1-video.mp4', size: 3 })
    expect(body.key).toMatch(/^video-tools\/user-1\/inputs\/.+\.mp4$/)
    expect(formDataSpy).not.toHaveBeenCalled()
    expect(arrayBufferSpy).not.toHaveBeenCalled()
    expect(uploadObjectStreamMock).toHaveBeenCalledWith(
      expect.any(ReadableStream),
      body.key,
      3,
      'video/mp4',
    )
  })

  it('rejects unsupported uploads', async () => {
    const request = new NextRequest('http://localhost:3000/api/video-tools/uploads', {
      method: 'POST',
      headers: {
        'content-length': '1',
        'content-type': 'text/plain',
        'x-file-name': encodeURIComponent('notes.txt'),
      },
      body: new Uint8Array([1]),
    })

    const response = await uploadVideo(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(400)
    expect(uploadObjectStreamMock).not.toHaveBeenCalled()
  })

  it('rejects a missing content length before consuming the request body', async () => {
    const request = new NextRequest('http://localhost:3000/api/video-tools/uploads', {
      method: 'POST',
      headers: {
        'content-type': 'video/mp4',
        'x-file-name': encodeURIComponent('shot-1-video.mp4'),
      },
      body: new Uint8Array([1, 2, 3]),
    })
    const readerSpy = vi.spyOn(request.body as ReadableStream<Uint8Array>, 'getReader')

    const response = await uploadVideo(request, { params: Promise.resolve({}) })
    const payload = await response.json() as { error: { details: { code: string } } }

    expect(response.status).toBe(400)
    expect(payload.error.details.code).toBe('VIDEO_TOOL_UPLOAD_LENGTH_REQUIRED')
    expect(readerSpy).not.toHaveBeenCalled()
    expect(uploadObjectStreamMock).not.toHaveBeenCalled()
  })

  it('rejects a malformed encoded filename before consuming the request body', async () => {
    const request = new NextRequest('http://localhost:3000/api/video-tools/uploads', {
      method: 'POST',
      headers: {
        'content-length': '3',
        'content-type': 'video/mp4',
        'x-file-name': '%E0%A4%A',
      },
      body: new Uint8Array([1, 2, 3]),
    })
    const readerSpy = vi.spyOn(request.body as ReadableStream<Uint8Array>, 'getReader')

    const response = await uploadVideo(request, { params: Promise.resolve({}) })
    const payload = await response.json() as { error: { details: { code: string } } }

    expect(response.status).toBe(400)
    expect(payload.error.details.code).toBe('VIDEO_TOOL_UPLOAD_NAME_INVALID')
    expect(readerSpy).not.toHaveBeenCalled()
    expect(uploadObjectStreamMock).not.toHaveBeenCalled()
  })

  it.each([
    ['invalid', '3.5', 'VIDEO_TOOL_UPLOAD_LENGTH_INVALID'],
    ['oversized', String(256 * 1024 * 1024 + 1), 'VIDEO_TOOL_UPLOAD_TOO_LARGE'],
  ])('rejects an %s content length before consuming the request body', async (_name, contentLength, errorCode) => {
    const request = new NextRequest('http://localhost:3000/api/video-tools/uploads', {
      method: 'POST',
      headers: {
        'content-length': contentLength,
        'content-type': 'video/mp4',
        'x-file-name': encodeURIComponent('shot-1-video.mp4'),
      },
      body: new Uint8Array([1, 2, 3]),
    })
    const readerSpy = vi.spyOn(request.body as ReadableStream<Uint8Array>, 'getReader')

    const response = await uploadVideo(request, { params: Promise.resolve({}) })
    const payload = await response.json() as { error: { details: { code: string } } }

    expect(response.status).toBe(400)
    expect(payload.error.details.code).toBe(errorCode)
    expect(readerSpy).not.toHaveBeenCalled()
    expect(uploadObjectStreamMock).not.toHaveBeenCalled()
  })

  it('rejects a request body shorter than its declared content length', async () => {
    const request = new NextRequest('http://localhost:3000/api/video-tools/uploads', {
      method: 'POST',
      headers: {
        'content-length': '4',
        'content-type': 'video/mp4',
        'x-file-name': encodeURIComponent('shot-1-video.mp4'),
      },
      body: new Uint8Array([1, 2, 3]),
    })

    const response = await uploadVideo(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    expect(uploadObjectStreamMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a request body longer than its declared content length', async () => {
    const request = new NextRequest('http://localhost:3000/api/video-tools/uploads', {
      method: 'POST',
      headers: {
        'content-length': '2',
        'content-type': 'video/mp4',
        'x-file-name': encodeURIComponent('shot-1-video.mp4'),
      },
      body: new Uint8Array([1, 2, 3]),
    })

    const response = await uploadVideo(request, { params: Promise.resolve({}) })
    const payload = await response.json() as { error: { details: { code: string } } }

    expect(response.status).toBe(400)
    expect(payload.error.details.code).toBe('VIDEO_TOOL_UPLOAD_LENGTH_MISMATCH')
    expect(uploadObjectStreamMock).toHaveBeenCalledTimes(1)
  })

  it('submits two owned inputs to the video queue contract', async () => {
    const request = buildMockRequest({
      path: '/api/video-tools/seam-concat',
      method: 'POST',
      body: {
        input1: { key: 'video-tools/user-1/inputs/one.mp4', name: 'one.mp4' },
        input2: { key: 'video-tools/user-1/inputs/two.mp4', name: 'two.mp4' },
        meta: { locale: 'zh' },
      },
    })

    const response = await submitSeamConcat(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      projectId: 'video-tools',
      type: 'video_seam_concat',
      targetType: 'VideoSeamConcat',
      maxAttempts: 1,
      payload: expect.objectContaining({
        input1Key: 'video-tools/user-1/inputs/one.mp4',
        input2Key: 'video-tools/user-1/inputs/two.mp4',
      }),
    }))
  })

  it('requires authentication before submission', async () => {
    authState.authenticated = false
    const request = buildMockRequest({
      path: '/api/video-tools/seam-concat',
      method: 'POST',
      body: {},
    })

    const response = await submitSeamConcat(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(401)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })
})
