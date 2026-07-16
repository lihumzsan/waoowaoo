import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as uploadVideo } from '@/app/api/video-tools/uploads/route'
import { POST as submitSeamConcat } from '@/app/api/video-tools/seam-concat/route'
import { buildMockRequest } from '../../../helpers/request'

const authState = vi.hoisted(() => ({ authenticated: true }))
const uploadObjectMock = vi.hoisted(() => vi.fn(async (_body: Buffer, key: string) => key))
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
  uploadObject: uploadObjectMock,
  getSignedUrl: vi.fn((key: string) => `/api/storage/sign?key=${encodeURIComponent(key)}`),
}))

vi.mock('@/lib/task/submitter', () => ({ submitTask: submitTaskMock }))
vi.mock('@/lib/task/resolve-locale', () => ({ resolveRequiredTaskLocale: vi.fn(() => 'zh') }))

describe('video tools routes', () => {
  beforeEach(() => {
    authState.authenticated = true
    uploadObjectMock.mockClear()
    submitTaskMock.mockClear()
  })

  it('uploads an authenticated MP4 to a user-scoped input key', async () => {
    const formData = new FormData()
    formData.set('file', new File([new Uint8Array([1, 2, 3])], 'shot-1-video.mp4', { type: 'video/mp4' }))
    const request = new NextRequest('http://localhost:3000/api/video-tools/uploads', {
      method: 'POST',
      body: formData,
    })

    const response = await uploadVideo(request, { params: Promise.resolve({}) })
    const body = await response.json() as { success: boolean; key: string; name: string; size: number }

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ success: true, name: 'shot-1-video.mp4', size: 3 })
    expect(body.key).toMatch(/^video-tools\/user-1\/inputs\/.+\.mp4$/)
    expect(uploadObjectMock).toHaveBeenCalledWith(expect.any(Buffer), body.key, undefined, 'video/mp4')
  })

  it('rejects unsupported uploads', async () => {
    const formData = new FormData()
    formData.set('file', new File([new Uint8Array([1])], 'notes.txt', { type: 'text/plain' }))
    const request = new NextRequest('http://localhost:3000/api/video-tools/uploads', {
      method: 'POST',
      body: formData,
    })

    const response = await uploadVideo(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(400)
    expect(uploadObjectMock).not.toHaveBeenCalled()
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
