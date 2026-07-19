import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as uploadVideo } from '@/app/api/video-tools/uploads/route'
import { POST as submitSeamConcat } from '@/app/api/video-tools/seam-concat/route'
import * as seamConcatRoute from '@/app/api/video-tools/seam-concat/route'
import { POST as submitFreeVoice } from '@/app/api/video-tools/free-voice/route'
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
const addTaskJobMock = vi.hoisted(() => vi.fn(async () => ({ id: 'job-1' })))
const queueState = vi.hoisted(() => ({ job: null as null | Record<string, unknown> }))
const getVideoJobMock = vi.hoisted(() => vi.fn(async () => queueState.job))
const createVideoToolFreeVoiceTaskMock = vi.hoisted(() => vi.fn(async () => ({
  record: {
    id: 'free-record-1',
    taskId: 'free-task-1',
    text: 'hello',
    voiceName: 'Narrator',
    status: 'queued',
    progress: 0,
    createdAt: '2026-07-19T00:00:00.000Z',
    updatedAt: '2026-07-19T00:00:00.000Z',
  },
  taskId: 'free-task-1',
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
vi.mock('@/lib/task/queues', () => ({
  addTaskJob: addTaskJobMock,
  videoQueue: { getJob: getVideoJobMock },
}))
vi.mock('@/lib/task/resolve-locale', () => ({ resolveRequiredTaskLocale: vi.fn(() => 'zh') }))
vi.mock('@/lib/video-tools/free-voice', () => ({
  createVideoToolFreeVoiceTask: createVideoToolFreeVoiceTaskMock,
}))

describe('video tools routes', () => {
  beforeEach(() => {
    authState.authenticated = true
    uploadObjectStreamMock.mockClear()
    submitTaskMock.mockClear()
    addTaskJobMock.mockClear()
    getVideoJobMock.mockClear()
    createVideoToolFreeVoiceTaskMock.mockClear()
    queueState.job = null
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

  it('queues two owned inputs without creating a persisted task', async () => {
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
    expect(addTaskJobMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      projectId: 'video-tools',
      type: 'video_seam_concat',
      targetType: 'VideoSeamConcat',
      persistence: 'transient',
      payload: expect.objectContaining({
        input1Key: 'video-tools/user-1/inputs/one.mp4',
        input2Key: 'video-tools/user-1/inputs/two.mp4',
      }),
    }), expect.objectContaining({ attempts: 1 }))
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('exposes a transient job status endpoint instead of task history', () => {
    expect(typeof (seamConcatRoute as { GET?: unknown }).GET).toBe('function')
  })

  it('returns the completed result from the authenticated user transient job', async () => {
    queueState.job = {
      data: {
        taskId: 'job-1',
        persistence: 'transient',
        type: 'video_seam_concat',
        userId: 'user-1',
      },
      progress: { progress: 90, stage: 'persist_output' },
      returnvalue: { videoKey: 'output.mp4', videoUrl: '/api/storage/sign?key=output.mp4' },
      failedReason: null,
      getState: vi.fn(async () => 'completed'),
    }
    const request = buildMockRequest({
      path: '/api/video-tools/seam-concat?taskId=job-1',
      method: 'GET',
    })
    const getStatus = (seamConcatRoute as { GET: typeof submitSeamConcat }).GET

    const response = await getStatus(request, { params: Promise.resolve({}) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      id: 'job-1',
      status: 'completed',
      progress: 100,
      result: { videoKey: 'output.mp4', videoUrl: '/api/storage/sign?key=output.mp4' },
      error: null,
    })
  })

  it('does not expose another user transient job', async () => {
    queueState.job = {
      data: {
        taskId: 'job-1',
        persistence: 'transient',
        type: 'video_seam_concat',
        userId: 'user-2',
      },
      getState: vi.fn(async () => 'active'),
    }
    const request = buildMockRequest({
      path: '/api/video-tools/seam-concat?taskId=job-1',
      method: 'GET',
    })
    const getStatus = (seamConcatRoute as { GET: typeof submitSeamConcat }).GET

    const response = await getStatus(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(404)
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

  it('queues standalone free voice as a transient video-tool result', async () => {
    const request = buildMockRequest({
      path: '/api/video-tools/free-voice',
      method: 'POST',
      body: {
        text: 'hello',
        projectId: 'project-1',
        characterId: 'character-1',
        meta: { locale: 'zh' },
      },
    })

    const response = await submitFreeVoice(request, { params: Promise.resolve({}) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      async: true,
      taskId: 'free-task-1',
      record: { id: 'free-record-1', status: 'queued' },
    })
    expect(createVideoToolFreeVoiceTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      locale: 'zh',
      text: 'hello',
      projectId: 'project-1',
      characterId: 'character-1',
    }))
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it.each([
    ['projectId', { text: 'hello', characterId: 'character-1' }],
    ['characterId', { text: 'hello', projectId: 'project-1' }],
  ])('rejects free voice submission without %s', async (_field, body) => {
    const request = buildMockRequest({
      path: '/api/video-tools/free-voice',
      method: 'POST',
      body,
    })

    const response = await submitFreeVoice(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    expect(createVideoToolFreeVoiceTaskMock).not.toHaveBeenCalled()
  })
})
