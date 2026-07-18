import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import type { TaskJobData } from '@/lib/task/types'
import { handleVideoSeamConcatTask } from '@/lib/workers/handlers/video-seam-concat'
import { getProviderConfig } from '@/lib/api-config'
import { runComfyUiVideoSeamConcatWorkflow } from '@/lib/providers/comfyui/client'
import { getSignedObjectUrl, getSignedUrl, uploadObjectStream } from '@/lib/storage'

vi.mock('@/lib/api-config', () => ({ getProviderConfig: vi.fn() }))
vi.mock('@/lib/providers/comfyui/client', () => ({
  runComfyUiVideoSeamConcatWorkflow: vi.fn(),
}))
vi.mock('@/lib/storage', () => ({
  getSignedObjectUrl: vi.fn(),
  getSignedUrl: vi.fn(),
  uploadObjectStream: vi.fn(),
}))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn(async () => undefined) }))

const getProviderConfigMock = vi.mocked(getProviderConfig)
const runWorkflowMock = vi.mocked(runComfyUiVideoSeamConcatWorkflow)
const getSignedObjectUrlMock = vi.mocked(getSignedObjectUrl)
const getSignedUrlMock = vi.mocked(getSignedUrl)
const uploadObjectStreamMock = vi.mocked(uploadObjectStream)
const persistedBytes: number[][] = []

function buildJob(payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-1',
      type: 'video_seam_concat',
      locale: 'zh',
      projectId: 'video-tools',
      targetType: 'VideoSeamConcat',
      targetId: 'target-1',
      payload,
      userId: 'user-1',
    },
  } as Job<TaskJobData>
}

describe('video seam concat worker handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getProviderConfigMock.mockResolvedValue({
      id: 'comfyui',
      name: 'ComfyUI',
      apiKey: '',
      baseUrl: 'http://127.0.0.1:8188',
    })
    getSignedObjectUrlMock
      .mockResolvedValueOnce('https://storage.test/one.mp4')
      .mockResolvedValueOnce('https://storage.test/two.mp4')
    runWorkflowMock.mockResolvedValue({
      videoUrl: 'http://127.0.0.1:8188/view?filename=result.mp4&type=output',
      mimeType: 'video/mp4',
      contentLength: 3,
    })
    persistedBytes.length = 0
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([9, 8, 7]), {
      status: 200,
      headers: { 'Content-Length': '3', 'Content-Type': 'video/mp4' },
    })))
    uploadObjectStreamMock.mockImplementation(async (body) => {
      persistedBytes.push(Array.from(new Uint8Array(await new Response(body).arrayBuffer())))
      return 'video-tools/user-1/outputs/result.mp4'
    })
    getSignedUrlMock.mockReturnValue('/api/storage/sign?key=result')
  })

  it('runs the two inputs in order and persists the MP4 result', async () => {
    const result = await handleVideoSeamConcatTask(buildJob({
      input1Key: 'video-tools/user-1/inputs/one.mp4',
      input1Name: 'one.mp4',
      input1TrimEndFrames: 12,
      input2Key: 'video-tools/user-1/inputs/two.mp4',
      input2Name: 'two.mp4',
      input2TrimStartFrames: 3,
    }))

    expect(runWorkflowMock).toHaveBeenCalledWith({
      baseUrl: 'http://127.0.0.1:8188',
      workflowKey: 'basevideo/tools/video-seam-concat-nvenc',
      videoUrls: ['https://storage.test/one.mp4', 'https://storage.test/two.mp4'],
      trimEndFrames: 12,
      trimStartFrames: 3,
    })
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:8188/view?filename=result.mp4&type=output',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(uploadObjectStreamMock).toHaveBeenCalledWith(
      expect.any(ReadableStream),
      expect.stringMatching(/^video-tools\/user-1\/outputs\/.+\.mp4$/),
      3,
      'video/mp4',
    )
    expect(uploadObjectStreamMock).toHaveBeenCalledTimes(1)
    expect(persistedBytes).toEqual([[9, 8, 7]])
    expect(result).toEqual(expect.objectContaining({
      videoKey: 'video-tools/user-1/outputs/result.mp4',
      videoUrl: '/api/storage/sign?key=result',
      mimeType: 'video/mp4',
      input1Name: 'one.mp4',
      input1TrimEndFrames: 12,
      input2Name: 'two.mp4',
      input2TrimStartFrames: 3,
    }))
  })

  it('uses the legacy trim defaults when the payload omits both trim values', async () => {
    const result = await handleVideoSeamConcatTask(buildJob({
      input1Key: 'video-tools/user-1/inputs/one.mp4',
      input1Name: 'one.mp4',
      input2Key: 'video-tools/user-1/inputs/two.mp4',
      input2Name: 'two.mp4',
    }))

    expect(runWorkflowMock).toHaveBeenCalledWith(expect.objectContaining({
      trimEndFrames: 0,
      trimStartFrames: 1,
    }))
    expect(result).toEqual(expect.objectContaining({
      input1TrimEndFrames: 0,
      input2TrimStartFrames: 1,
    }))
  })

  it.each([
    ['input1 trim', { input1TrimEndFrames: 1.5 }],
    ['input2 trim', { input2TrimStartFrames: 100_001 }],
  ])('rejects an invalid provided %s value', async (_label, invalidTrim) => {
    await expect(handleVideoSeamConcatTask(buildJob({
      input1Key: 'video-tools/user-1/inputs/one.mp4',
      input1Name: 'one.mp4',
      input2Key: 'video-tools/user-1/inputs/two.mp4',
      input2Name: 'two.mp4',
      ...invalidTrim,
    }))).rejects.toThrow('VIDEO_SEAM_CONCAT_PAYLOAD_INVALID')

    expect(runWorkflowMock).not.toHaveBeenCalled()
  })

  it('rejects missing input payload fields', async () => {
    await expect(handleVideoSeamConcatTask(buildJob({})))
      .rejects.toThrow('VIDEO_SEAM_CONCAT_PAYLOAD_INVALID')
    expect(runWorkflowMock).not.toHaveBeenCalled()
  })

  it('requires a configured ComfyUI base URL', async () => {
    getProviderConfigMock.mockResolvedValue({ id: 'comfyui', name: 'ComfyUI', apiKey: '' })

    await expect(handleVideoSeamConcatTask(buildJob({
      input1Key: 'video-tools/user-1/inputs/one.mp4',
      input1Name: 'one.mp4',
      input2Key: 'video-tools/user-1/inputs/two.mp4',
      input2Name: 'two.mp4',
    }))).rejects.toThrow('COMFYUI_BASE_URL_MISSING')
  })
})
