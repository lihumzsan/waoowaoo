import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import type { TaskJobData } from '@/lib/task/types'
import { handleVideoSeamConcatTask } from '@/lib/workers/handlers/video-seam-concat'
import { getProviderConfig } from '@/lib/api-config'
import {
  runComfyUiVideoSeamBridgeComposeWorkflow,
  runComfyUiVideoSeamConcatWorkflow,
  runComfyUiVideoSeamEndpointWorkflow,
  runComfyUiVideoWorkflow,
} from '@/lib/providers/comfyui/client'
import { getSignedObjectUrl, getSignedUrl, uploadObjectStream } from '@/lib/storage'

vi.mock('@/lib/api-config', () => ({ getProviderConfig: vi.fn() }))
vi.mock('@/lib/providers/comfyui/client', () => ({
  runComfyUiVideoSeamBridgeComposeWorkflow: vi.fn(),
  runComfyUiVideoSeamConcatWorkflow: vi.fn(),
  runComfyUiVideoSeamEndpointWorkflow: vi.fn(),
  runComfyUiVideoWorkflow: vi.fn(),
}))
vi.mock('@/lib/storage', () => ({
  getSignedObjectUrl: vi.fn(),
  getSignedUrl: vi.fn(),
  uploadObjectStream: vi.fn(),
}))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn(async () => undefined) }))

const getProviderConfigMock = vi.mocked(getProviderConfig)
const runWorkflowMock = vi.mocked(runComfyUiVideoSeamConcatWorkflow)
const runEndpointWorkflowMock = vi.mocked(runComfyUiVideoSeamEndpointWorkflow)
const runVideoWorkflowMock = vi.mocked(runComfyUiVideoWorkflow)
const runBridgeComposeWorkflowMock = vi.mocked(runComfyUiVideoSeamBridgeComposeWorkflow)
const getSignedObjectUrlMock = vi.mocked(getSignedObjectUrl)
const getSignedUrlMock = vi.mocked(getSignedUrl)
const uploadObjectStreamMock = vi.mocked(uploadObjectStream)
const persistedBytes: number[][] = []
let responseBodyCancelCount = 0

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

const validPayload = {
  input1Key: 'video-tools/user-1/inputs/one.mp4',
  input1Name: 'one.mp4',
  input2Key: 'video-tools/user-1/inputs/two.mp4',
  input2Name: 'two.mp4',
}

describe('video seam concat worker handler', () => {
  function stubOutputResponse(
    headers: Record<string, string>,
    closeBody = true,
    status = 200,
    cancelError?: Error,
  ): void {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([9, 8, 7]))
        if (closeBody) controller.close()
      },
    })
    const originalCancel = body.cancel.bind(body)
    Object.defineProperty(body, 'cancel', {
      configurable: true,
      value: (reason?: unknown) => {
        responseBodyCancelCount += 1
        if (cancelError) return Promise.reject(cancelError)
        return originalCancel(reason)
      },
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {
      status,
      headers,
    })))
  }

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
    runEndpointWorkflowMock.mockResolvedValue({ imageBase64: 'AQID', mimeType: 'image/png' })
    runVideoWorkflowMock.mockResolvedValue({
      videoUrl: 'http://127.0.0.1:8188/view?filename=bridge.mp4&type=output',
      mimeType: 'video/mp4',
      contentLength: 3,
    })
    runBridgeComposeWorkflowMock.mockResolvedValue({
      videoUrl: 'http://127.0.0.1:8188/view?filename=result.mp4&type=output',
      mimeType: 'video/mp4',
      contentLength: 3,
    })
    persistedBytes.length = 0
    responseBodyCancelCount = 0
    stubOutputResponse({ 'Content-Length': '3', 'Content-Type': 'video/mp4' })
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
    expect(responseBodyCancelCount).toBe(0)
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

  it('builds an endpoint-locked LTX bridge instead of inserting a hard cut', async () => {
    await handleVideoSeamConcatTask(buildJob({
      ...validPayload,
      mode: 'ai_bridge',
      bridge: { durationSeconds: 6, prompt: 'camera continues a slow push-in' },
    }))

    expect(runEndpointWorkflowMock).toHaveBeenNthCalledWith(1, {
      baseUrl: 'http://127.0.0.1:8188',
      videoUrl: 'https://storage.test/one.mp4',
      position: 'end',
      trimFrames: 0,
    })
    expect(runEndpointWorkflowMock).toHaveBeenNthCalledWith(2, {
      baseUrl: 'http://127.0.0.1:8188',
      videoUrl: 'https://storage.test/two.mp4',
      position: 'start',
      trimFrames: 1,
    })
    expect(runVideoWorkflowMock).toHaveBeenCalledWith(expect.objectContaining({
      firstFrameImageUrl: 'data:image/png;base64,AQID',
      lastFrameImageUrl: 'data:image/png;base64,AQID',
      durationSeconds: 6,
      fps: 24,
      prompt: 'camera continues a slow push-in',
    }))
    expect(runBridgeComposeWorkflowMock).toHaveBeenCalledWith({
      baseUrl: 'http://127.0.0.1:8188',
      videoUrls: [
        'https://storage.test/one.mp4',
        'http://127.0.0.1:8188/view?filename=bridge.mp4&type=output',
        'https://storage.test/two.mp4',
      ],
      trimEndFrames: 0,
      trimStartFrames: 1,
    })
    expect(runWorkflowMock).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'missing content length',
      headerLength: undefined,
      outputLength: undefined,
      error: 'COMFYUI_VIEW_CONTENT_LENGTH_MISSING',
    },
    {
      name: 'invalid content length',
      headerLength: 'invalid',
      outputLength: 3,
      error: 'COMFYUI_VIEW_CONTENT_LENGTH_INVALID',
    },
    {
      name: 'mismatched content length',
      headerLength: '4',
      outputLength: 3,
      error: 'COMFYUI_VIEW_CONTENT_LENGTH_MISMATCH',
    },
  ])('cancels the output body on $name before upload', async ({ headerLength, outputLength, error }) => {
    runWorkflowMock.mockResolvedValue({
      videoUrl: 'http://127.0.0.1:8188/view?filename=result.mp4&type=output',
      mimeType: 'video/mp4',
      ...(outputLength === undefined ? {} : { contentLength: outputLength }),
    })
    stubOutputResponse({
      ...(headerLength === undefined ? {} : { 'Content-Length': headerLength }),
      'Content-Type': 'video/mp4',
    }, false)

    await expect(handleVideoSeamConcatTask(buildJob(validPayload))).rejects.toThrow(error)

    expect(uploadObjectStreamMock).not.toHaveBeenCalled()
    expect(responseBodyCancelCount).toBe(1)
  })

  it('cancels the output body when streaming storage rejects before consuming it', async () => {
    stubOutputResponse({ 'Content-Length': '3', 'Content-Type': 'video/mp4' }, false)
    uploadObjectStreamMock.mockRejectedValue(new Error('storage upload failed'))

    await expect(handleVideoSeamConcatTask(buildJob(validPayload)))
      .rejects.toThrow('storage upload failed')

    expect(uploadObjectStreamMock).toHaveBeenCalledTimes(1)
    expect(responseBodyCancelCount).toBe(1)
  })

  it('cancels the output body when ComfyUI returns an error response', async () => {
    stubOutputResponse({ 'Content-Type': 'text/plain' }, true, 502)

    await expect(handleVideoSeamConcatTask(buildJob(validPayload)))
      .rejects.toThrow('COMFYUI_VIEW_FAILED: 502')

    expect(uploadObjectStreamMock).not.toHaveBeenCalled()
    expect(responseBodyCancelCount).toBe(1)
  })

  it('preserves the upload error when output body cancellation also fails', async () => {
    stubOutputResponse(
      { 'Content-Length': '3', 'Content-Type': 'video/mp4' },
      false,
      200,
      new Error('cancel failed'),
    )
    uploadObjectStreamMock.mockRejectedValue(new Error('storage upload failed'))

    await expect(handleVideoSeamConcatTask(buildJob(validPayload)))
      .rejects.toThrow('storage upload failed')

    expect(responseBodyCancelCount).toBe(1)
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
