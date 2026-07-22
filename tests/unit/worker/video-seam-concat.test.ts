import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import type { TaskJobData } from '@/lib/task/types'
import { handleVideoSeamConcatTask } from '@/lib/workers/handlers/video-seam-concat'
import { getProviderConfig } from '@/lib/api-config'
import {
  runComfyUiVideoSeamConcatWorkflow,
  runComfyUiVideoSeamMotionBridgeWorkflow,
} from '@/lib/providers/comfyui/client'
import { getSignedObjectUrl, getSignedUrl, uploadObjectStream } from '@/lib/storage'
import {
  composeVideoSeamOutput,
  createVideoSeamWorkspace,
  downloadVideoSeamFile,
  extractVideoSeamAnchors,
  openVideoSeamOutput,
  probeVideoSeamFile,
  readVideoSeamAnchorDataUrl,
  verifyVideoSeamOutput,
} from '@/lib/video/video-seam-media'

vi.mock('@/lib/api-config', () => ({ getProviderConfig: vi.fn() }))
vi.mock('@/lib/providers/comfyui/client', () => ({
  runComfyUiVideoSeamConcatWorkflow: vi.fn(),
  runComfyUiVideoSeamMotionBridgeWorkflow: vi.fn(),
}))
vi.mock('@/lib/storage', () => ({
  getSignedObjectUrl: vi.fn(),
  getSignedUrl: vi.fn(),
  uploadObjectStream: vi.fn(),
}))
vi.mock('@/lib/video/video-seam-media', () => ({
  composeVideoSeamOutput: vi.fn(),
  createVideoSeamWorkspace: vi.fn(),
  downloadVideoSeamFile: vi.fn(),
  extractVideoSeamAnchors: vi.fn(),
  openVideoSeamOutput: vi.fn(),
  probeVideoSeamFile: vi.fn(),
  readVideoSeamAnchorDataUrl: vi.fn(),
  verifyVideoSeamOutput: vi.fn(),
}))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn(async () => undefined) }))

const getProviderConfigMock = vi.mocked(getProviderConfig)
const runWorkflowMock = vi.mocked(runComfyUiVideoSeamConcatWorkflow)
const runMotionBridgeWorkflowMock = vi.mocked(runComfyUiVideoSeamMotionBridgeWorkflow)
const getSignedObjectUrlMock = vi.mocked(getSignedObjectUrl)
const getSignedUrlMock = vi.mocked(getSignedUrl)
const uploadObjectStreamMock = vi.mocked(uploadObjectStream)
const composeOutputMock = vi.mocked(composeVideoSeamOutput)
const createWorkspaceMock = vi.mocked(createVideoSeamWorkspace)
const downloadFileMock = vi.mocked(downloadVideoSeamFile)
const extractAnchorsMock = vi.mocked(extractVideoSeamAnchors)
const openOutputMock = vi.mocked(openVideoSeamOutput)
const probeFileMock = vi.mocked(probeVideoSeamFile)
const readAnchorMock = vi.mocked(readVideoSeamAnchorDataUrl)
const verifyOutputMock = vi.mocked(verifyVideoSeamOutput)

const workspace = {
  directory: '/tmp/video-seam-task-1',
  input1Path: '/tmp/video-seam-task-1/input-1.mp4',
  input2Path: '/tmp/video-seam-task-1/input-2.mp4',
  input1AnchorPaths: [
    '/tmp/video-seam-task-1/input-1-anchor-0.png',
    '/tmp/video-seam-task-1/input-1-anchor-1.png',
  ] as [string, string],
  input2AnchorPaths: [
    '/tmp/video-seam-task-1/input-2-anchor-0.png',
    '/tmp/video-seam-task-1/input-2-anchor-1.png',
  ] as [string, string],
  normalizedAnchorPaths: [
    '/tmp/video-seam-task-1/anchor-0-normalized.png',
    '/tmp/video-seam-task-1/anchor-1-normalized.png',
    '/tmp/video-seam-task-1/anchor-2-normalized.png',
    '/tmp/video-seam-task-1/anchor-3-normalized.png',
  ] as [string, string, string, string],
  bridgePath: '/tmp/video-seam-task-1/bridge.mp4',
  outputPath: '/tmp/video-seam-task-1/output.mp4',
  cleanup: vi.fn(async () => undefined),
}

const probe1 = {
  width: 1280,
  height: 720,
  fps: 24,
  frameCount: 240,
  durationSeconds: 10,
  hasAudio: true,
  displayRotationDegrees: 90 as const,
}
const probe2 = {
  width: 1280,
  height: 720,
  fps: 24,
  frameCount: 300,
  durationSeconds: 12.5,
  hasAudio: true,
  displayRotationDegrees: 270 as const,
}
const bridgeProbe = {
  width: 1280,
  height: 736,
  fps: 24,
  frameCount: 97,
  durationSeconds: 97 / 24,
  hasAudio: false,
}
const verifiedOutput = {
  width: 1280,
  height: 720,
  fps: 24,
  frameCount: 622,
  durationSeconds: 622 / 24,
  hasAudio: true,
}
const anchors: [string, string, string, string] = [
  'data:image/png;base64,AQ==',
  'data:image/png;base64,Ag==',
  'data:image/png;base64,Aw==',
  'data:image/png;base64,BA==',
]
const operationOrder: string[] = []
const persistedBytes: number[][] = []
let responseBodyCancelCount = 0

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

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
    vi.resetAllMocks()
    operationOrder.length = 0
    persistedBytes.length = 0
    responseBodyCancelCount = 0

    getProviderConfigMock.mockResolvedValue({
      id: 'comfyui',
      name: 'ComfyUI',
      apiKey: '',
      baseUrl: 'http://127.0.0.1:8188',
    })
    getSignedObjectUrlMock.mockImplementation(async (key) => (
      key.includes('/one.mp4')
        ? 'https://storage.test/one.mp4'
        : 'https://storage.test/two.mp4'
    ))
    runWorkflowMock.mockResolvedValue({
      videoUrl: 'http://127.0.0.1:8188/view?filename=result.mp4&type=output',
      mimeType: 'video/mp4',
      contentLength: 3,
    })
    runMotionBridgeWorkflowMock.mockImplementation(async () => {
      operationOrder.push('generate')
      return {
        videoUrl: 'http://127.0.0.1:8188/view?filename=bridge.mp4&type=output',
        mimeType: 'video/mp4',
        contentLength: 3,
      }
    })
    createWorkspaceMock.mockResolvedValue(workspace)
    workspace.cleanup.mockImplementation(async () => {
      operationOrder.push('cleanup')
    })
    downloadFileMock.mockImplementation(async (_sourceUrl, destinationPath) => {
      operationOrder.push(`download:${destinationPath}`)
    })
    probeFileMock.mockImplementation(async (filePath) => {
      operationOrder.push(`probe:${filePath}`)
      if (filePath === workspace.input1Path) return probe1
      if (filePath === workspace.input2Path) return probe2
      if (filePath === workspace.bridgePath) return bridgeProbe
      throw new Error(`unexpected probe path: ${filePath}`)
    })
    extractAnchorsMock.mockImplementation(async ({ inputPath }) => {
      operationOrder.push(`extract:${inputPath}`)
    })
    readAnchorMock
      .mockResolvedValueOnce(anchors[0])
      .mockResolvedValueOnce(anchors[1])
      .mockResolvedValueOnce(anchors[2])
      .mockResolvedValueOnce(anchors[3])
    composeOutputMock.mockImplementation(async () => {
      operationOrder.push('compose')
    })
    verifyOutputMock.mockImplementation(async () => {
      operationOrder.push('verify')
      return verifiedOutput
    })
    openOutputMock.mockImplementation(async () => {
      operationOrder.push('open')
      return {
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([6, 5, 4]))
            controller.close()
          },
        }),
        contentLength: 3,
        mimeType: 'video/mp4',
      }
    })
    stubOutputResponse({ 'Content-Length': '3', 'Content-Type': 'video/mp4' })
    uploadObjectStreamMock.mockImplementation(async (body) => {
      operationOrder.push('upload')
      persistedBytes.push(Array.from(new Uint8Array(await new Response(body).arrayBuffer())))
      return 'video-tools/user-1/outputs/result.mp4'
    })
    getSignedUrlMock.mockReturnValue('/api/storage/sign?key=result')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('runs the two direct inputs in order and persists the remote MP4 result', async () => {
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
      mode: 'direct',
      input1Name: 'one.mp4',
      input1TrimEndFrames: 12,
      input2Name: 'two.mp4',
      input2TrimStartFrames: 3,
    }))
    expect(createWorkspaceMock).not.toHaveBeenCalled()
    expect(downloadFileMock).not.toHaveBeenCalled()
    expect(probeFileMock).not.toHaveBeenCalled()
    expect(extractAnchorsMock).not.toHaveBeenCalled()
    expect(readAnchorMock).not.toHaveBeenCalled()
    expect(composeOutputMock).not.toHaveBeenCalled()
    expect(verifyOutputMock).not.toHaveBeenCalled()
    expect(openOutputMock).not.toHaveBeenCalled()
    expect(runMotionBridgeWorkflowMock).not.toHaveBeenCalled()
  })

  it('builds, verifies, and persists one local four-anchor AI bridge output', async () => {
    const result = await handleVideoSeamConcatTask(buildJob({
      ...validPayload,
      mode: 'ai_bridge',
      bridge: { durationSeconds: 4, prompt: 'continuous motion through all four anchors' },
    }))

    expect(downloadFileMock).toHaveBeenNthCalledWith(
      1,
      'https://storage.test/one.mp4',
      workspace.input1Path,
      { signal: expect.any(AbortSignal) },
    )
    expect(downloadFileMock).toHaveBeenNthCalledWith(
      2,
      'https://storage.test/two.mp4',
      workspace.input2Path,
      { signal: expect.any(AbortSignal) },
    )
    expect(probeFileMock).toHaveBeenNthCalledWith(1, workspace.input1Path)
    expect(probeFileMock).toHaveBeenNthCalledWith(2, workspace.input2Path)
    expect(extractAnchorsMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      inputPath: workspace.input1Path,
      indices: [233, 239],
      rawOutputPaths: workspace.input1AnchorPaths,
      normalizedOutputPaths: [workspace.normalizedAnchorPaths[0], workspace.normalizedAnchorPaths[1]],
      displayRotationDegrees: 90,
    }))
    expect(extractAnchorsMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      inputPath: workspace.input2Path,
      indices: [1, 7],
      rawOutputPaths: workspace.input2AnchorPaths,
      normalizedOutputPaths: [workspace.normalizedAnchorPaths[2], workspace.normalizedAnchorPaths[3]],
      displayRotationDegrees: 270,
    }))
    expect(readAnchorMock.mock.calls.map(([filePath]) => filePath)).toEqual(workspace.normalizedAnchorPaths)
    expect(runMotionBridgeWorkflowMock).toHaveBeenCalledWith({
      baseUrl: 'http://127.0.0.1:8188',
      prompt: 'continuous motion through all four anchors',
      anchorImageUrls: anchors,
      generatedAnchorIndices: [0, 6, 90, 96],
      width: 1280,
      height: 736,
      fps: 24,
      durationSeconds: 4,
    })
    expect(downloadFileMock).toHaveBeenNthCalledWith(
      3,
      'http://127.0.0.1:8188/view?filename=bridge.mp4&type=output',
      workspace.bridgePath,
    )
    expect(probeFileMock).toHaveBeenNthCalledWith(3, workspace.bridgePath)
    expect(composeOutputMock).toHaveBeenCalledWith(expect.objectContaining({
      input1Path: workspace.input1Path,
      bridgePath: workspace.bridgePath,
      input2Path: workspace.input2Path,
      outputPath: workspace.outputPath,
      plan: expect.objectContaining({ generatedFrameCount: 97 }),
    }))
    expect(verifyOutputMock).toHaveBeenCalledWith(
      workspace.outputPath,
      expect.objectContaining({ generatedFrameCount: 97 }),
    )
    expect(openOutputMock).toHaveBeenCalledWith(workspace.outputPath)
    expect(uploadObjectStreamMock).toHaveBeenCalledTimes(1)
    expect(uploadObjectStreamMock).toHaveBeenCalledWith(
      expect.any(ReadableStream),
      expect.stringMatching(/^video-tools\/user-1\/outputs\/.+\.mp4$/),
      3,
      'video/mp4',
    )
    expect(persistedBytes).toEqual([[6, 5, 4]])
    expect(operationOrder.indexOf('verify')).toBeLessThan(operationOrder.indexOf('open'))
    expect(operationOrder.indexOf('open')).toBeLessThan(operationOrder.indexOf('upload'))
    expect(operationOrder.indexOf(`probe:${workspace.bridgePath}`))
      .toBeLessThan(operationOrder.indexOf('compose'))
    expect(workspace.cleanup).toHaveBeenCalledTimes(1)
    expect(operationOrder.at(-1)).toBe('cleanup')
    expect(fetch).not.toHaveBeenCalled()
    expect(runWorkflowMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      videoKey: 'video-tools/user-1/outputs/result.mp4',
      videoUrl: '/api/storage/sign?key=result',
      mimeType: 'video/mp4',
      mode: 'ai_bridge',
      input1Name: 'one.mp4',
      input2Name: 'two.mp4',
      probes: { input1: probe1, input2: probe2 },
      output: verifiedOutput,
      bridge: {
        requestedDurationSeconds: 4,
        handleFrames: 6,
        generatedFrameCount: 97,
        generationCanvas: {
          contentWidth: 1280,
          contentHeight: 720,
          width: 1280,
          height: 736,
          padLeft: 0,
          padTop: 8,
          padRight: 0,
          padBottom: 8,
        },
        sourceAnchors: {
          input1Pre: 233,
          input1Endpoint: 239,
          input2Endpoint: 1,
          input2Post: 7,
        },
        generatedAnchors: [0, 6, 90, 96],
        centralFrameCount: 83,
        centralSilenceSeconds: 83 / 24,
        video2AudioTempoFactor: 1,
        audioPolicy: 'both',
        targetBitrateMbps: 10,
      },
    })
  })

  it('cleans the AI workspace exactly once when LTX generation fails', async () => {
    runMotionBridgeWorkflowMock.mockImplementation(async () => {
      operationOrder.push('generate')
      throw new Error('LTX generation failed')
    })

    await expect(handleVideoSeamConcatTask(buildJob({
      ...validPayload,
      mode: 'ai_bridge',
      bridge: { durationSeconds: 4 },
    }))).rejects.toThrow('LTX generation failed')

    expect(workspace.cleanup).toHaveBeenCalledTimes(1)
    expect(operationOrder.at(-1)).toBe('cleanup')
    expect(composeOutputMock).not.toHaveBeenCalled()
    expect(verifyOutputMock).not.toHaveBeenCalled()
    expect(openOutputMock).not.toHaveBeenCalled()
    expect(uploadObjectStreamMock).not.toHaveBeenCalled()
  })

  it('aborts and settles the peer input download before cleaning a failed AI workspace', async () => {
    const inputFailure = new Error('input 1 download failed')
    downloadFileMock.mockImplementation(async (...rawArgs) => {
      const [, destinationPath, options] = rawArgs as unknown as [
        string,
        string,
        { signal?: AbortSignal } | undefined,
      ]
      if (destinationPath === workspace.input1Path) throw inputFailure
      await new Promise<void>((resolve) => {
        options?.signal?.addEventListener('abort', () => {
          operationOrder.push('peer-download-settled')
          resolve()
        }, { once: true })
      })
    })

    await expect(handleVideoSeamConcatTask(buildJob({
      ...validPayload,
      mode: 'ai_bridge',
      bridge: { durationSeconds: 4 },
    }))).rejects.toBe(inputFailure)

    expect(operationOrder).toContain('peer-download-settled')
    expect(operationOrder.indexOf('peer-download-settled'))
      .toBeLessThan(operationOrder.indexOf('cleanup'))
    expect(workspace.cleanup).toHaveBeenCalledTimes(1)
    expect(probeFileMock).not.toHaveBeenCalled()
  })

  it('settles the peer input probe before cleaning while preserving the primary probe error', async () => {
    const primaryError = new Error('input 1 probe failed')
    const peerError = new Error('input 2 probe failed later')
    const peerProbe = createDeferred<typeof probe2>()
    probeFileMock
      .mockRejectedValueOnce(primaryError)
      .mockImplementationOnce(async () => {
        try {
          return await peerProbe.promise
        } finally {
          operationOrder.push('peer-probe-settled')
        }
      })

    const task = handleVideoSeamConcatTask(buildJob({
      ...validPayload,
      mode: 'ai_bridge',
      bridge: { durationSeconds: 4 },
    }))
    let taskError: unknown
    const observedTask = task.catch((error) => { taskError = error })
    await vi.waitFor(() => expect(probeFileMock).toHaveBeenCalledTimes(2))
    expect(workspace.cleanup).not.toHaveBeenCalled()

    peerProbe.reject(peerError)

    await observedTask
    expect(taskError).toBe(primaryError)
    expect(operationOrder.indexOf('peer-probe-settled'))
      .toBeLessThan(operationOrder.indexOf('cleanup'))
    expect(workspace.cleanup).toHaveBeenCalledTimes(1)
    expect(extractAnchorsMock).not.toHaveBeenCalled()
  })

  it('settles the peer anchor extraction before cleaning while preserving the primary extraction error', async () => {
    const primaryError = new Error('input 1 anchor extraction failed')
    const peerError = new Error('input 2 anchor extraction failed later')
    const peerExtraction = createDeferred<void>()
    extractAnchorsMock
      .mockRejectedValueOnce(primaryError)
      .mockImplementationOnce(async () => {
        try {
          await peerExtraction.promise
        } finally {
          operationOrder.push('peer-extraction-settled')
        }
      })

    const task = handleVideoSeamConcatTask(buildJob({
      ...validPayload,
      mode: 'ai_bridge',
      bridge: { durationSeconds: 4 },
    }))
    let taskError: unknown
    const observedTask = task.catch((error) => { taskError = error })
    await vi.waitFor(() => expect(extractAnchorsMock).toHaveBeenCalledTimes(2))
    expect(workspace.cleanup).not.toHaveBeenCalled()

    peerExtraction.reject(peerError)

    await observedTask
    expect(taskError).toBe(primaryError)
    expect(operationOrder.indexOf('peer-extraction-settled'))
      .toBeLessThan(operationOrder.indexOf('cleanup'))
    expect(workspace.cleanup).toHaveBeenCalledTimes(1)
    expect(readAnchorMock).not.toHaveBeenCalled()
  })

  it('preserves the primary AI failure when workspace cleanup also fails', async () => {
    const primaryError = new Error('sentinel generation failure')
    runMotionBridgeWorkflowMock.mockRejectedValue(primaryError)
    workspace.cleanup.mockRejectedValue(new Error('workspace cleanup failed'))

    await expect(handleVideoSeamConcatTask(buildJob({
      ...validPayload,
      mode: 'ai_bridge',
      bridge: { durationSeconds: 4 },
    }))).rejects.toBe(primaryError)

    expect(workspace.cleanup).toHaveBeenCalledTimes(1)
  })

  it('preserves a successful AI result when workspace cleanup fails', async () => {
    workspace.cleanup.mockRejectedValue(new Error('workspace cleanup failed'))

    await expect(handleVideoSeamConcatTask(buildJob({
      ...validPayload,
      mode: 'ai_bridge',
      bridge: { durationSeconds: 4 },
    }))).resolves.toMatchObject({
      videoKey: 'video-tools/user-1/outputs/result.mp4',
      mode: 'ai_bridge',
    })

    expect(workspace.cleanup).toHaveBeenCalledTimes(1)
  })

  it('cancels the local AI output without masking a storage upload error', async () => {
    const storageError = new Error('sentinel storage upload failed')
    const cancelError = new Error('local output cancel failed')
    const cancelOutput = vi.fn(async () => {
      throw cancelError
    })
    const body = new ReadableStream<Uint8Array>({ cancel: cancelOutput })
    openOutputMock.mockResolvedValue({
      body,
      contentLength: 3,
      mimeType: 'video/mp4',
    })
    uploadObjectStreamMock.mockRejectedValue(storageError)

    await expect(handleVideoSeamConcatTask(buildJob({
      ...validPayload,
      mode: 'ai_bridge',
      bridge: { durationSeconds: 4 },
    }))).rejects.toBe(storageError)

    expect(uploadObjectStreamMock).toHaveBeenCalledTimes(1)
    expect(cancelOutput).toHaveBeenCalledTimes(1)
    expect(workspace.cleanup).toHaveBeenCalledTimes(1)
    expect(getSignedUrlMock).not.toHaveBeenCalled()
  })

  it('uses a prompt for continuous evolution across all four anchors when bridge motion is omitted', async () => {
    await handleVideoSeamConcatTask(buildJob({
      ...validPayload,
      mode: 'ai_bridge',
      bridge: { durationSeconds: 4 },
    }))

    expect(runMotionBridgeWorkflowMock).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('all four supplied anchors'),
    }))
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
  ])('cancels the direct output body on $name before upload', async ({ headerLength, outputLength, error }) => {
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

  it('cancels the direct output body when streaming storage rejects before consuming it', async () => {
    stubOutputResponse({ 'Content-Length': '3', 'Content-Type': 'video/mp4' }, false)
    uploadObjectStreamMock.mockRejectedValue(new Error('storage upload failed'))

    await expect(handleVideoSeamConcatTask(buildJob(validPayload)))
      .rejects.toThrow('storage upload failed')

    expect(uploadObjectStreamMock).toHaveBeenCalledTimes(1)
    expect(responseBodyCancelCount).toBe(1)
  })

  it('cancels the direct output body when ComfyUI returns an error response', async () => {
    stubOutputResponse({ 'Content-Type': 'text/plain' }, true, 502)

    await expect(handleVideoSeamConcatTask(buildJob(validPayload)))
      .rejects.toThrow('COMFYUI_VIEW_FAILED: 502')

    expect(uploadObjectStreamMock).not.toHaveBeenCalled()
    expect(responseBodyCancelCount).toBe(1)
  })

  it('preserves the direct upload error when output body cancellation also fails', async () => {
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
    const result = await handleVideoSeamConcatTask(buildJob(validPayload))

    expect(runWorkflowMock).toHaveBeenCalledWith(expect.objectContaining({
      trimEndFrames: 0,
      trimStartFrames: 1,
    }))
    expect(result).toEqual(expect.objectContaining({
      mode: 'direct',
      input1TrimEndFrames: 0,
      input2TrimStartFrames: 1,
    }))
  })

  it.each([
    ['input1 trim', { input1TrimEndFrames: 1.5 }],
    ['input2 trim', { input2TrimStartFrames: 100_001 }],
  ])('rejects an invalid provided %s value', async (_label, invalidTrim) => {
    await expect(handleVideoSeamConcatTask(buildJob({
      ...validPayload,
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

    await expect(handleVideoSeamConcatTask(buildJob(validPayload)))
      .rejects.toThrow('COMFYUI_BASE_URL_MISSING')
  })
})
