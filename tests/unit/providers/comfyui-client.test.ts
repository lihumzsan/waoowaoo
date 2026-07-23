import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  collectMediaRefsFromOutputs,
  resolveComfyUiPromptQueuePhase,
  runComfyUiImageWorkflow,
  runComfyUiVideoSeamMotionBridgeWorkflow,
  runComfyUiVideoSeamConcatWorkflow,
  runComfyUiVideoWorkflow,
  runComfyUiWorkflow,
} from '@/lib/providers/comfyui/client'
import { COMFYUI_LTX23_WORKFLOW_KEYS } from '@/lib/providers/comfyui/ltx23-workflow-profiles'

function writeWorkflow(root: string, workflowKey: string, workflow: unknown) {
  const filePath = join(root, `${workflowKey}.json`)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(workflow), 'utf-8')
}

describe('comfyui client media refs', () => {
  let workflowRoot: string | null = null

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete process.env.COMFYUI_WORKFLOW_ROOT
    delete process.env.COMFYUI_VIDEO_QUEUE_TIMEOUT_MS
    delete process.env.COMFYUI_VIDEO_PENDING_TIMEOUT_MS
    delete process.env.COMFYUI_VIDEO_PROMPT_DUMP
    delete process.env.INTERNAL_APP_URL
    if (workflowRoot) {
      rmSync(workflowRoot, { recursive: true, force: true })
      workflowRoot = null
    }
  })

  it('collects classic filename-array outputs', () => {
    const refs = collectMediaRefsFromOutputs({
      '15': {
        gifs: [{
          filename: 'AnimateDiff_00001.mp4',
          subfolder: 'video',
          type: 'output',
        }],
      },
    })

    expect(refs).toEqual([{
      filename: 'AnimateDiff_00001.mp4',
      subfolder: 'video',
      type: 'output',
    }])
  })

  it('collects SaveVideo view urls from history outputs', () => {
    const refs = collectMediaRefsFromOutputs({
      '211': {
        video_url: '/view?filename=LTX_2.3_i2v_00001.mp4&subfolder=video%2FLTX_2.3_i2v&type=output',
      },
    })

    expect(refs).toEqual([{
      filename: 'LTX_2.3_i2v_00001.mp4',
      subfolder: 'video/LTX_2.3_i2v',
      type: 'output',
    }])
  })

  it('collects relative media paths exposed as plain strings', () => {
    const refs = collectMediaRefsFromOutputs({
      '211': {
        value: 'output/video/LTX_2.3_i2v/LTX_2.3_i2v_00002.mp4',
      },
    })

    expect(refs).toEqual([{
      filename: 'LTX_2.3_i2v_00002.mp4',
      subfolder: 'video/LTX_2.3_i2v',
      type: 'output',
    }])
  })

  it('detects prompt phase from queue payloads', () => {
    expect(resolveComfyUiPromptQueuePhase({
      queue_running: [[12, 'prompt-running', {}]],
      queue_pending: [[15, 'prompt-pending', {}]],
    }, 'prompt-running')).toBe('running')

    expect(resolveComfyUiPromptQueuePhase({
      queue_running: [[12, 'prompt-running', {}]],
      queue_pending: [[15, 'prompt-pending', {}]],
    }, 'prompt-pending')).toBe('pending')

    expect(resolveComfyUiPromptQueuePhase({
      queue_running: [[12, 'prompt-running', {}]],
      queue_pending: [[15, 'prompt-pending', {}]],
    }, 'prompt-missing')).toBe('absent')
  })

  it('waits through queue pending time before starting video execution timeout', async () => {
    vi.useFakeTimers()
    let historyPollCount = 0
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.toString()

      if (url.endsWith('/prompt')) {
        return new Response(JSON.stringify({ prompt_id: 'prompt-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.includes('/history/prompt-1')) {
        historyPollCount += 1
        if (historyPollCount < 3) {
          return new Response(JSON.stringify({}), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        return new Response(JSON.stringify({
          'prompt-1': {
            outputs: {
              '40': {
                video_url: '/view?filename=test.mp4&subfolder=video%2Fltx&type=output',
              },
            },
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.endsWith('/queue')) {
        const phase = historyPollCount < 2 ? 'pending' : 'running'
        return new Response(JSON.stringify({
          queue_running: phase === 'running' ? [[1, 'prompt-1', {}]] : [],
          queue_pending: phase === 'pending' ? [[2, 'prompt-1', {}]] : [],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.includes('/view?filename=test.mp4')) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' },
        })
      }

      throw new Error(`Unexpected fetch url: ${url}`)
    })

    const resultPromise = runComfyUiWorkflow({
      baseUrl: 'http://127.0.0.1:8878',
      workflow: { '1': { class_type: 'Dummy', inputs: {} } },
      expect: 'video',
    })

    await vi.advanceTimersByTimeAsync(3_500)
    const result = await resultPromise

    expect(result.mimeType).toBe('video/mp4')
    expect(result.dataBase64).toBe(Buffer.from([1, 2, 3]).toString('base64'))
    expect(fetchMock).toHaveBeenCalled()
  })

  it('rejects an HTTP 200 ComfyUI view response whose MIME does not match the expected media', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.toString()

      if (url.endsWith('/prompt')) {
        return new Response(JSON.stringify({ prompt_id: 'prompt-invalid-mime' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('/history/prompt-invalid-mime')) {
        return new Response(JSON.stringify({
          'prompt-invalid-mime': {
            outputs: {
              '40': {
                video_url: '/view?filename=invalid-mime.mp4&type=output',
              },
            },
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('/view?filename=invalid-mime.mp4')) {
        return new Response('<html>proxy error</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        })
      }
      throw new Error(`Unexpected fetch url: ${url}`)
    })

    const resultPromise = runComfyUiWorkflow({
      baseUrl: 'http://127.0.0.1:8878',
      workflow: { '1': { class_type: 'Dummy', inputs: {} } },
      expect: 'video',
      returnViewUrl: true,
    })
    const rejection = expect(resultPromise).rejects.toThrow('COMFYUI_VIEW_MIME_INVALID')

    await vi.advanceTimersByTimeAsync(1_500)
    await rejection
  })

  it('does not abandon a prompt that is still pending in the ComfyUI queue after queue timeout', async () => {
    vi.useFakeTimers()
    process.env.COMFYUI_VIDEO_QUEUE_TIMEOUT_MS = '2000'
    let historyPollCount = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.toString()

      if (url.endsWith('/prompt')) {
        return new Response(JSON.stringify({ prompt_id: 'prompt-long-pending' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.includes('/history/prompt-long-pending')) {
        historyPollCount += 1
        if (historyPollCount < 5) {
          return new Response(JSON.stringify({}), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        return new Response(JSON.stringify({
          'prompt-long-pending': {
            outputs: {
              '41': {
                video_url: '/view?filename=long-pending.mp4&type=output',
              },
            },
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.endsWith('/queue')) {
        return new Response(JSON.stringify({
          queue_running: [],
          queue_pending: [[3, 'prompt-long-pending', {}]],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.includes('/view?filename=long-pending.mp4')) {
        return new Response(new Uint8Array([13, 14, 15]), {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' },
        })
      }

      throw new Error(`Unexpected fetch url: ${url}`)
    })

    const resultPromise = runComfyUiWorkflow({
      baseUrl: 'http://127.0.0.1:8878',
      workflow: { '1': { class_type: 'Dummy', inputs: {} } },
      expect: 'video',
    })

    await vi.advanceTimersByTimeAsync(5_500)
    const result = await resultPromise

    expect(result.mimeType).toBe('video/mp4')
    expect(result.dataBase64).toBe(Buffer.from([13, 14, 15]).toString('base64'))
  })

  it('continues polling when a history request times out while the prompt is still running', async () => {
    vi.useFakeTimers()
    let historyPollCount = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.toString()

      if (url.endsWith('/prompt')) {
        return new Response(JSON.stringify({ prompt_id: 'prompt-busy-history' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.includes('/history/prompt-busy-history')) {
        historyPollCount += 1
        if (historyPollCount === 1) {
          const error = new Error('The operation was aborted due to timeout')
          error.name = 'TimeoutError'
          throw error
        }
        if (historyPollCount < 3) {
          return new Response(JSON.stringify({}), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        return new Response(JSON.stringify({
          'prompt-busy-history': {
            outputs: {
              '42': {
                video_url: '/view?filename=busy-history.mp4&type=output',
              },
            },
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.endsWith('/queue')) {
        return new Response(JSON.stringify({
          queue_running: [[4, 'prompt-busy-history', {}]],
          queue_pending: [],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.includes('/view?filename=busy-history.mp4')) {
        return new Response(new Uint8Array([21, 22, 23]), {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' },
        })
      }

      throw new Error(`Unexpected fetch url: ${url}`)
    })

    const resultPromise = runComfyUiWorkflow({
      baseUrl: 'http://127.0.0.1:8878',
      workflow: { '1': { class_type: 'Dummy', inputs: {} } },
      expect: 'video',
    })

    await vi.advanceTimersByTimeAsync(4_500)
    const result = await resultPromise

    expect(result.mimeType).toBe('video/mp4')
    expect(result.dataBase64).toBe(Buffer.from([21, 22, 23]).toString('base64'))
  })

  it('prefers the decoded final image over preview concat outputs', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.toString()

      if (url.endsWith('/prompt')) {
        return new Response(JSON.stringify({ prompt_id: 'prompt-2' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.includes('/history/prompt-2')) {
        return new Response(JSON.stringify({
          'prompt-2': {
            outputs: {
              '10': {
                images: [{
                  filename: 'final-image.png',
                  subfolder: 'ComfyUI',
                  type: 'output',
                }],
              },
              '27': {
                images: [{
                  filename: 'reference-collage.png',
                  subfolder: 'ComfyUI',
                  type: 'output',
                }],
              },
            },
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.includes('/view?filename=final-image.png')) {
        return new Response(new Uint8Array([4, 5, 6]), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        })
      }

      throw new Error(`Unexpected fetch url: ${url}`)
    })

    const result = await runComfyUiWorkflow({
      baseUrl: 'http://127.0.0.1:8878',
      workflow: {
        '10': { class_type: 'SaveImage', inputs: { images: ['34', 0] } },
        '27': { class_type: 'SaveImage', inputs: { images: ['35', 0] } },
        '34': { class_type: 'VAEDecode', inputs: {} },
        '35': { class_type: 'ImageConcatMulti', inputs: {} },
      },
      expect: 'image',
    })

    expect(result.mimeType).toBe('image/png')
    expect(result.dataBase64).toBe(Buffer.from([4, 5, 6]).toString('base64'))
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/view?filename=final-image.png'),
      expect.any(Object),
    )
  })

  it('uploads a neutral reference for image workflows that require LoadImage but receive no refs', async () => {
    vi.useFakeTimers()
    workflowRoot = mkdtempSync(join(tmpdir(), 'waoowaoo-comfyui-client-'))
    process.env.COMFYUI_WORKFLOW_ROOT = workflowRoot
    writeWorkflow(workflowRoot, 'baseimage/client/neutral-reference', {
      nodes: [
        {
          id: 1,
          type: 'LoadImage',
          inputs: [
            { name: 'image', type: 'COMBO', widget: { name: 'image' }, link: null },
            { name: 'upload', type: 'IMAGEUPLOAD', widget: { name: 'upload' }, link: null },
          ],
          widgets_values: ['bundled-demo.png', 'image'],
        },
        {
          id: 2,
          type: 'SaveImage',
          inputs: [
            { name: 'images', type: 'IMAGE', link: 10 },
          ],
          widgets_values: [],
        },
      ],
      links: [
        [10, 1, 0, 2, 0, 'IMAGE'],
      ],
    })

    let uploadedImages = 0
    let submittedWorkflow: unknown = null
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.toString()

      if (url.endsWith('/upload/image')) {
        uploadedImages += 1
        return new Response(JSON.stringify({ name: 'neutral-upload.png' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.endsWith('/prompt')) {
        submittedWorkflow = JSON.parse(String(init?.body || '{}')).prompt
        return new Response(JSON.stringify({ prompt_id: 'prompt-neutral' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.includes('/history/prompt-neutral')) {
        return new Response(JSON.stringify({
          'prompt-neutral': {
            outputs: {
              '2': {
                images: [{
                  filename: 'neutral-result.png',
                  subfolder: '',
                  type: 'output',
                }],
              },
            },
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.includes('/view?filename=neutral-result.png')) {
        return new Response(new Uint8Array([7, 8, 9]), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        })
      }

      throw new Error(`Unexpected fetch url: ${url}`)
    })

    const resultPromise = runComfyUiImageWorkflow({
      baseUrl: 'http://127.0.0.1:8878',
      workflowKey: 'baseimage/client/neutral-reference',
      prompt: 'fresh prompt',
      width: 1280,
      height: 720,
    })

    await vi.advanceTimersByTimeAsync(1_500)
    const result = await resultPromise

    expect(uploadedImages).toBe(1)
    expect(result.mimeType).toBe('image/png')
    expect((submittedWorkflow as Record<string, { inputs: Record<string, unknown> }>)['1']?.inputs.image).toBe('neutral-upload.png')
    expect((submittedWorkflow as Record<string, { inputs: Record<string, unknown> }>)['1']?.inputs.image).not.toBe('bundled-demo.png')
  })

  it('uploads video first, reference, and last frames before resolving workflow image filenames', async () => {
    vi.useFakeTimers()
    workflowRoot = mkdtempSync(join(tmpdir(), 'waoowaoo-comfyui-client-'))
    process.env.COMFYUI_WORKFLOW_ROOT = workflowRoot
    writeWorkflow(workflowRoot, 'basevideo/client/reference-order', {
      '1': { class_type: 'LoadImage', inputs: { image: 'old-first.png', upload: 'image' } },
      '2': { class_type: 'LoadImage', inputs: { image: 'old-reference.png', upload: 'image' } },
      '3': { class_type: 'LoadImage', inputs: { image: 'old-last.png', upload: 'image' } },
      '4': { class_type: 'SaveVideo', inputs: { images: ['1', 0] } },
    })

    const sourceFetches: string[] = []
    const uploadFilenames = ['uploaded-first.png', 'uploaded-reference.png', 'uploaded-last.png']
    let uploadCount = 0
    let submittedWorkflow: unknown = null

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.toString()

      if (url.startsWith('https://assets.test/')) {
        sourceFetches.push(url)
        return new Response(new Uint8Array([uploadCount + 1]), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        })
      }

      if (url.endsWith('/upload/image')) {
        const name = uploadFilenames[uploadCount]
        uploadCount += 1
        return new Response(JSON.stringify({ name }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.endsWith('/prompt')) {
        submittedWorkflow = JSON.parse(String(init?.body || '{}')).prompt
        return new Response(JSON.stringify({ prompt_id: 'prompt-video-reference-order' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.includes('/history/prompt-video-reference-order')) {
        return new Response(JSON.stringify({
          'prompt-video-reference-order': {
            outputs: {
              '4': {
                video_url: '/view?filename=video-reference-order.mp4&type=output',
              },
            },
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.includes('/view?filename=video-reference-order.mp4')) {
        return new Response(new Uint8Array([10, 11, 12]), {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' },
        })
      }

      throw new Error(`Unexpected fetch url: ${url}`)
    })

    const resultPromise = runComfyUiVideoWorkflow({
      baseUrl: 'http://127.0.0.1:8878',
      workflowKey: 'basevideo/client/reference-order',
      prompt: 'video prompt',
      firstFrameImageUrl: 'https://assets.test/first.png',
      referenceImageUrls: ['', 'https://assets.test/reference.png'],
      lastFrameImageUrl: 'https://assets.test/last.png',
    })

    await vi.advanceTimersByTimeAsync(1_500)
    const result = await resultPromise

    expect(sourceFetches).toEqual([
      'https://assets.test/first.png',
      'https://assets.test/reference.png',
      'https://assets.test/last.png',
    ])
    expect(uploadCount).toBe(3)
    expect(result).toEqual({
      videoUrl: 'http://127.0.0.1:8878/view?filename=video-reference-order.mp4&subfolder=&type=output',
      mimeType: 'video/mp4',
    })
    expect((submittedWorkflow as Record<string, { inputs: Record<string, unknown> }>)['1']?.inputs.image).toBe('uploaded-first.png')
  })

  it('injects a neutral audio upload into video workflows that contain LoadAudio placeholders', async () => {
    vi.useFakeTimers()
    workflowRoot = mkdtempSync(join(tmpdir(), 'waoowaoo-comfyui-client-'))
    process.env.COMFYUI_WORKFLOW_ROOT = workflowRoot
    writeWorkflow(workflowRoot, 'basevideo/client/neutral-audio', {
      '1': { class_type: 'LoadImage', inputs: { image: 'old-first.png', upload: 'image' } },
      '2': { class_type: 'LoadAudio', inputs: { audio: 'missing-placeholder.wav', upload: 'audio' } },
      '3': { class_type: 'VHS_VideoCombine', inputs: { images: ['1', 0], audio: ['2', 0] } },
    })

    const uploadFilenames = ['uploaded-first.png', 'uploaded-neutral.wav']
    let uploadCount = 0
    let submittedWorkflow: unknown = null

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.toString()

      if (url.startsWith('https://assets.test/')) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        })
      }

      if (url.endsWith('/upload/image')) {
        const name = uploadFilenames[uploadCount]
        uploadCount += 1
        return new Response(JSON.stringify({ name }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.endsWith('/prompt')) {
        submittedWorkflow = JSON.parse(String(init?.body || '{}')).prompt
        return new Response(JSON.stringify({ prompt_id: 'prompt-neutral-audio' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.includes('/history/prompt-neutral-audio')) {
        return new Response(JSON.stringify({
          'prompt-neutral-audio': {
            outputs: {
              '3': {
                video_url: '/view?filename=neutral-audio.mp4&type=output',
              },
            },
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.includes('/view?filename=neutral-audio.mp4')) {
        return new Response(new Uint8Array([10, 11, 12]), {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' },
        })
      }

      throw new Error(`Unexpected fetch url: ${url}`)
    })

    const resultPromise = runComfyUiVideoWorkflow({
      baseUrl: 'http://127.0.0.1:8878',
      workflowKey: 'basevideo/client/neutral-audio',
      prompt: 'video prompt',
      firstFrameImageUrl: 'https://assets.test/first.png',
      durationSeconds: 2,
    })

    await vi.advanceTimersByTimeAsync(1_500)
    const result = await resultPromise

    expect(uploadCount).toBe(2)
    expect(result.mimeType).toBe('video/mp4')
    expect((submittedWorkflow as Record<string, { inputs: Record<string, unknown> }>)['2']?.inputs.audio).toBe('uploaded-neutral.wav')
  })

  it('uses provided reference audio for video workflows before falling back to neutral audio', async () => {
    vi.useFakeTimers()
    workflowRoot = mkdtempSync(join(tmpdir(), 'waoowaoo-comfyui-client-'))
    process.env.COMFYUI_WORKFLOW_ROOT = workflowRoot
    writeWorkflow(workflowRoot, 'basevideo/client/reference-audio', {
      '1': { class_type: 'LoadImage', inputs: { image: 'old-first.png', upload: 'image' } },
      '2': { class_type: 'LoadAudio', inputs: { audio: 'missing-placeholder.wav', upload: 'audio' } },
      '3': { class_type: 'VHS_VideoCombine', inputs: { images: ['1', 0], audio: ['2', 0] } },
    })

    const sourceFetches: string[] = []
    const uploadFilenames = ['uploaded-first.png', 'uploaded-reference.wav']
    let uploadCount = 0
    let submittedWorkflow: unknown = null

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.toString()

      if (url.startsWith('https://assets.test/')) {
        sourceFetches.push(url)
        const contentType = url.endsWith('.wav') ? 'audio/wav' : 'image/png'
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'Content-Type': contentType },
        })
      }

      if (url.endsWith('/upload/image')) {
        const name = uploadFilenames[uploadCount]
        uploadCount += 1
        return new Response(JSON.stringify({ name }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.endsWith('/prompt')) {
        submittedWorkflow = JSON.parse(String(init?.body || '{}')).prompt
        return new Response(JSON.stringify({ prompt_id: 'prompt-reference-audio' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.includes('/history/prompt-reference-audio')) {
        return new Response(JSON.stringify({
          'prompt-reference-audio': {
            outputs: {
              '3': {
                video_url: '/view?filename=reference-audio.mp4&type=output',
              },
            },
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.includes('/view?filename=reference-audio.mp4')) {
        return new Response(new Uint8Array([10, 11, 12]), {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' },
        })
      }

      throw new Error(`Unexpected fetch url: ${url}`)
    })

    const params = {
      baseUrl: 'http://127.0.0.1:8878',
      workflowKey: 'basevideo/client/reference-audio',
      prompt: 'video prompt',
      firstFrameImageUrl: 'https://assets.test/first.png',
      referenceAudioUrls: ['https://assets.test/line-1.wav'],
      durationSeconds: 2,
    } as Parameters<typeof runComfyUiVideoWorkflow>[0] & { referenceAudioUrls: string[] }
    const resultPromise = runComfyUiVideoWorkflow(params)

    await vi.advanceTimersByTimeAsync(1_500)
    const result = await resultPromise

    expect(sourceFetches).toEqual([
      'https://assets.test/first.png',
      'https://assets.test/line-1.wav',
    ])
    expect(uploadCount).toBe(2)
    expect(result.mimeType).toBe('video/mp4')
    expect((submittedWorkflow as Record<string, { inputs: Record<string, unknown> }>)['2']?.inputs.audio).toBe('uploaded-reference.wav')
  })

  it('fetches relative signed reference audio URLs through the internal app base URL', async () => {
    vi.useFakeTimers()
    process.env.INTERNAL_APP_URL = 'http://internal.test'
    workflowRoot = mkdtempSync(join(tmpdir(), 'waoowaoo-comfyui-client-'))
    process.env.COMFYUI_WORKFLOW_ROOT = workflowRoot
    writeWorkflow(workflowRoot, 'basevideo/client/relative-reference-audio', {
      '1': { class_type: 'LoadImage', inputs: { image: 'old-first.png', upload: 'image' } },
      '2': { class_type: 'LoadAudio', inputs: { audio: 'missing-placeholder.wav', upload: 'audio' } },
      '3': { class_type: 'VHS_VideoCombine', inputs: { images: ['1', 0], audio: ['2', 0] } },
    })

    const sourceFetches: string[] = []
    const uploadFilenames = ['uploaded-first.png', 'uploaded-reference.flac']
    let uploadCount = 0

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.toString()

      if (url === 'https://assets.test/first.png' || url.startsWith('http://internal.test/api/storage/sign')) {
        sourceFetches.push(url)
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'Content-Type': url.endsWith('.png') ? 'image/png' : 'audio/flac' },
        })
      }

      if (url.endsWith('/upload/image')) {
        const name = uploadFilenames[uploadCount]
        uploadCount += 1
        return new Response(JSON.stringify({ name }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.endsWith('/prompt')) {
        return new Response(JSON.stringify({ prompt_id: 'prompt-relative-reference-audio' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.includes('/history/prompt-relative-reference-audio')) {
        return new Response(JSON.stringify({
          'prompt-relative-reference-audio': {
            outputs: {
              '3': {
                video_url: '/view?filename=relative-reference-audio.mp4&type=output',
              },
            },
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.includes('/view?filename=relative-reference-audio.mp4')) {
        return new Response(new Uint8Array([10, 11, 12]), {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' },
        })
      }

      throw new Error(`Unexpected fetch url: ${url}`)
    })

    const resultPromise = runComfyUiVideoWorkflow({
      baseUrl: 'http://127.0.0.1:8878',
      workflowKey: 'basevideo/client/relative-reference-audio',
      prompt: 'video prompt',
      firstFrameImageUrl: 'https://assets.test/first.png',
      referenceAudioUrls: ['/api/storage/sign?key=voice%2Fline-1.flac&expires=7200'],
      durationSeconds: 2,
    })

    await vi.advanceTimersByTimeAsync(1_500)
    const result = await resultPromise

    expect(result.mimeType).toBe('video/mp4')
    expect(uploadCount).toBe(2)
    expect(sourceFetches).toEqual([
      'https://assets.test/first.png',
      'http://internal.test/api/storage/sign?key=voice%2Fline-1.flac&expires=7200',
    ])
  })

  it('normalizes model filename inputs to server object_info aliases before prompt submit', async () => {
    vi.useFakeTimers()
    workflowRoot = mkdtempSync(join(tmpdir(), 'waoowaoo-comfyui-client-'))
    process.env.COMFYUI_WORKFLOW_ROOT = workflowRoot
    writeWorkflow(workflowRoot, 'basevideo/client/model-alias', {
      '1': { class_type: 'LoadImage', inputs: { image: 'old-first.png', upload: 'image' } },
      '2': { class_type: 'VAELoaderKJ', inputs: { vae_name: 'LTX23_audio_vae_bf16.safetensors' } },
      '3': { class_type: 'VHS_VideoCombine', inputs: { images: ['1', 0], vae: ['2', 0] } },
    })

    let submittedWorkflow: unknown = null

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.toString()

      if (url.startsWith('https://assets.test/')) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        })
      }

      if (url.endsWith('/upload/image')) {
        return new Response(JSON.stringify({ name: 'uploaded-first.png' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.endsWith('/object_info/VAELoaderKJ')) {
        return new Response(JSON.stringify({
          VAELoaderKJ: {
            input: {
              required: {
                vae_name: [[
                  'flux\\flux2-vae.safetensors',
                  'ltx\\LTX23_audio_vae_bf16.safetensors',
                ]],
              },
            },
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.endsWith('/prompt')) {
        submittedWorkflow = JSON.parse(String(init?.body || '{}')).prompt
        return new Response(JSON.stringify({ prompt_id: 'prompt-model-alias' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.includes('/history/prompt-model-alias')) {
        return new Response(JSON.stringify({
          'prompt-model-alias': {
            outputs: {
              '3': {
                video_url: '/view?filename=model-alias.mp4&type=output',
              },
            },
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.includes('/view?filename=model-alias.mp4')) {
        return new Response(new Uint8Array([10, 11, 12]), {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' },
        })
      }

      throw new Error(`Unexpected fetch url: ${url}`)
    })

    const resultPromise = runComfyUiVideoWorkflow({
      baseUrl: 'http://127.0.0.1:8878',
      workflowKey: 'basevideo/client/model-alias',
      prompt: 'video prompt',
      firstFrameImageUrl: 'https://assets.test/first.png',
    })

    await vi.advanceTimersByTimeAsync(1_500)
    const result = await resultPromise

    expect(result.mimeType).toBe('video/mp4')
    expect((submittedWorkflow as Record<string, { inputs: Record<string, unknown> }>)['2']?.inputs.vae_name).toBe('ltx\\LTX23_audio_vae_bf16.safetensors')
  })

  it('preflights and submits four ordered motion anchors through the specialized Goon runner', async () => {
    vi.useFakeTimers()
    const uploadedNames = ['a-pre.png', 'a-end.png', 'b-start.png', 'b-post.png']
    const uploadedAnchorBytes: number[] = []
    let uploadIndex = 0
    let submittedWorkflow: Record<string, { class_type: string; inputs: Record<string, unknown> }> | null = null

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.toString()

      if (url.endsWith('/object_info/LTXVImgToVideoInplaceKJ')) {
        return new Response(JSON.stringify({
          LTXVImgToVideoInplaceKJ: {
            input: {
              required: {
                num_images: ['COMFY_DYNAMICCOMBO_V3', {
                  display_name: 'Number of Images',
                  tooltip: 'Select how many images to insert',
                  options: [
                    { key: '1', inputs: { required: {}, optional: {} } },
                    { key: '2', inputs: { required: {}, optional: {} } },
                    { key: '3', inputs: { required: {}, optional: {} } },
                    { key: '4', inputs: { required: {}, optional: {} } },
                  ],
                }],
              },
            },
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('/object_info/')) {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.endsWith('/upload/image')) {
        const image = (init?.body as FormData).get('image')
        const bytes = image instanceof Blob
          ? new Uint8Array(await image.arrayBuffer())
          : new Uint8Array()
        uploadedAnchorBytes.push(bytes[0] ?? -1)
        const name = uploadedNames[uploadIndex]
        uploadIndex += 1
        return new Response(JSON.stringify({ name }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.endsWith('/prompt')) {
        submittedWorkflow = JSON.parse(String(init?.body || '{}')).prompt
        return new Response(JSON.stringify({ prompt_id: 'prompt-four-anchor' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('/history/prompt-four-anchor')) {
        return new Response(JSON.stringify({
          'prompt-four-anchor': {
            outputs: {
              '75': {
                video_url: '/view?filename=four-anchor.mp4&type=output',
              },
            },
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('/view?filename=four-anchor.mp4')) {
        return new Response(new Uint8Array([9, 8, 7]), {
          status: 200,
          headers: { 'Content-Length': '3', 'Content-Type': 'video/mp4' },
        })
      }
      throw new Error(`Unexpected fetch url: ${url}`)
    })

    const resultPromise = runComfyUiVideoSeamMotionBridgeWorkflow({
      baseUrl: 'http://127.0.0.1:8188',
      prompt: 'continuous motion',
      anchorImageUrls: [
        `data:image/png;base64,${Buffer.from([1]).toString('base64')}`,
        `data:image/png;base64,${Buffer.from([2]).toString('base64')}`,
        `data:image/png;base64,${Buffer.from([3]).toString('base64')}`,
        `data:image/png;base64,${Buffer.from([4]).toString('base64')}`,
      ],
      generatedAnchorIndices: [0, 6, 90, 96],
      width: 1280,
      height: 736,
      fps: 24,
      durationSeconds: 4,
    })

    await vi.advanceTimersByTimeAsync(1_500)
    const result = await resultPromise

    expect(uploadedAnchorBytes).toEqual([1, 2, 3, 4])
    expect(uploadIndex).toBe(4)
    expect(submittedWorkflow).not.toBeNull()
    const resolvedWorkflow = submittedWorkflow as unknown as Record<
      string,
      { class_type: string; inputs: Record<string, unknown> }
    >
    for (const nodeId of ['265', '275']) {
      expect(resolvedWorkflow[nodeId]?.inputs).toMatchObject({
        num_images: '4',
        'num_images.index_1': 0,
        'num_images.index_2': 6,
        'num_images.index_3': 90,
        'num_images.index_4': 96,
      })
    }
    expect(resolvedWorkflow['233']?.inputs.value).toBe(24)
    expect(result).toEqual({
      videoUrl: 'http://127.0.0.1:8188/view?filename=four-anchor.mp4&subfolder=&type=output',
      mimeType: 'video/mp4',
      contentLength: 3,
    })
  })

  it.each([
    {
      name: 'missing object info response',
      status: 404,
      objectInfo: null,
    },
    {
      name: 'null object info response',
      status: 200,
      objectInfo: null,
    },
    {
      name: 'missing num_images max',
      status: 200,
      objectInfo: {
        LTXVImgToVideoInplaceKJ: {
          input: {
            required: {
              num_images: ['INT', { default: 2, min: 1 }],
            },
          },
        },
      },
    },
    {
      name: 'nonnumeric num_images max',
      status: 200,
      objectInfo: {
        LTXVImgToVideoInplaceKJ: {
          input: {
            required: {
              num_images: ['INT', { default: 2, min: 1, max: '4' }],
            },
          },
        },
      },
    },
    {
      name: 'num_images max of two',
      status: 200,
      objectInfo: {
        LTXVImgToVideoInplaceKJ: {
          input: {
            required: {
              num_images: ['INT', { default: 2, min: 1, max: 2 }],
            },
          },
        },
      },
    },
    {
      name: 'dynamic num_images options without four',
      status: 200,
      objectInfo: {
        LTXVImgToVideoInplaceKJ: {
          input: {
            required: {
              num_images: ['COMFY_DYNAMICCOMBO_V3', {
                options: [
                  { key: '1', inputs: { required: {}, optional: {} } },
                  { key: '2', inputs: { required: {}, optional: {} } },
                  { key: '3', inputs: { required: {}, optional: {} } },
                ],
              }],
            },
          },
        },
      },
    },
  ])('rejects $name before any upload or prompt submission', async ({ status, objectInfo }) => {
    let uploadCallCount = 0
    let promptCallCount = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.toString()

      if (url.endsWith('/object_info/LTXVImgToVideoInplaceKJ')) {
        return new Response(JSON.stringify(objectInfo), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.endsWith('/upload/image')) {
        uploadCallCount += 1
        return new Response(JSON.stringify({ name: `anchor-${uploadCallCount}.png` }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.endsWith('/prompt')) {
        promptCallCount += 1
        return new Response(JSON.stringify({ prompt_id: 'must-not-submit' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`Unexpected fetch url: ${url}`)
    })

    await expect(runComfyUiVideoSeamMotionBridgeWorkflow({
      baseUrl: 'http://127.0.0.1:8188',
      prompt: 'continuous motion',
      anchorImageUrls: [
        'data:image/png;base64,AQ==',
        'data:image/png;base64,Ag==',
        'data:image/png;base64,Aw==',
        'data:image/png;base64,BA==',
      ],
      generatedAnchorIndices: [0, 6, 90, 96],
      width: 1280,
      height: 736,
      fps: 24,
      durationSeconds: 4,
    })).rejects.toThrow('VIDEO_SEAM_FOUR_ANCHOR_UNSUPPORTED')
    expect(uploadCallCount).toBe(0)
    expect(promptCallCount).toBe(0)
  })

  it('uploads two videos in order and submits the seam-concat graph', async () => {
    vi.useFakeTimers()
    const uploadedNames = [
      'first-upload.mp4',
      'second-upload.mp4',
      'default-first-upload.mp4',
      'default-second-upload.mp4',
    ]
    const submittedGraphs: Array<Record<string, { class_type: string; inputs: Record<string, unknown> }>> = []
    const uploadBodies: unknown[] = []
    const uploadHeaders: Headers[] = []
    const uploadPayloads: Uint8Array[] = []
    let uploadIndex = 0

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.toString()

      if (url.startsWith('https://assets.test/')) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'Content-Length': '3', 'Content-Type': 'video/mp4' },
        })
      }

      if (url.endsWith('/upload/image')) {
        uploadBodies.push(init?.body)
        uploadHeaders.push(new Headers(init?.headers))
        if (init?.body instanceof ReadableStream) {
          uploadPayloads.push(new Uint8Array(await new Response(init.body).arrayBuffer()))
        }
        const name = uploadedNames[uploadIndex]
        uploadIndex += 1
        return new Response(JSON.stringify({ name }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.endsWith('/prompt')) {
        const body = JSON.parse(String(init?.body)) as { prompt: Record<string, { class_type: string; inputs: Record<string, unknown> }> }
        submittedGraphs.push(body.prompt)
        return new Response(JSON.stringify({ prompt_id: 'prompt-seam-concat' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.includes('/history/prompt-seam-concat')) {
        return new Response(JSON.stringify({
          'prompt-seam-concat': {
            outputs: {
              '18': {
                gifs: [{ filename: 'shot-3-video.mp4', subfolder: '', type: 'output' }],
              },
            },
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.includes('/view?filename=shot-3-video.mp4')) {
        return new Response(new Uint8Array([9, 8, 7]), {
          status: 200,
          headers: { 'Content-Length': '3', 'Content-Type': 'video/mp4' },
        })
      }

      throw new Error(`Unexpected fetch url: ${url}`)
    })

    const resultPromise = runComfyUiVideoSeamConcatWorkflow({
      baseUrl: 'http://127.0.0.1:8188',
      videoUrls: [
        'https://assets.test/shot-1.mp4%22%0D%0AX-Evil%3Ayes',
        'https://assets.test/shot-2.mp4',
      ],
      trimEndFrames: 3,
      trimStartFrames: 4,
    })

    await vi.advanceTimersByTimeAsync(1_500)
    const result = await resultPromise

    expect(result).toEqual({
      videoUrl: 'http://127.0.0.1:8188/view?filename=shot-3-video.mp4&subfolder=&type=output',
      mimeType: 'video/mp4',
      contentLength: 3,
    })
    expect(uploadIndex).toBe(2)
    expect(uploadBodies).toHaveLength(2)
    expect(uploadBodies.every((body) => body instanceof ReadableStream)).toBe(true)
    expect(uploadHeaders.every((headers) => headers.get('content-type')?.startsWith('multipart/form-data; boundary='))).toBe(true)
    expect(uploadHeaders.every((headers) => Number(headers.get('content-length')) > 3)).toBe(true)
    expect(uploadPayloads.every((payload, index) => (
      payload.byteLength === Number(uploadHeaders[index]?.get('content-length'))
    ))).toBe(true)
    const firstUpload = new TextDecoder().decode(uploadPayloads[0])
    const contentDisposition = firstUpload.split('\r\n')
      .find((line) => line.startsWith('Content-Disposition: form-data; name="image"'))
    expect(contentDisposition).toMatch(
      /^Content-Disposition: form-data; name="image"; filename="[a-zA-Z0-9._-]+"$/,
    )
    expect(firstUpload).toContain('Content-Type: video/mp4')
    expect(firstUpload).toContain('Content-Disposition: form-data; name="type"')
    expect(firstUpload).toContain('input')
    expect(submittedGraphs).toHaveLength(1)
    expect(submittedGraphs[0]?.['1']?.inputs.file).toBe('first-upload.mp4')
    expect(submittedGraphs[0]?.['2']?.inputs.file).toBe('second-upload.mp4')
    expect(submittedGraphs[0]?.['7']?.inputs['values.b']).toBe(3)
    expect(submittedGraphs[0]?.['8']?.inputs['values.b']).toBe(4)
    expect(submittedGraphs[0]?.['10']?.inputs.batch_index).toBe(4)
    expect(submittedGraphs[0]?.['13']?.inputs['values.a']).toBe(4)

    const defaultResultPromise = runComfyUiVideoSeamConcatWorkflow({
      baseUrl: 'http://127.0.0.1:8188',
      videoUrls: ['https://assets.test/shot-1.mp4', 'https://assets.test/shot-2.mp4'],
    })

    await vi.advanceTimersByTimeAsync(1_500)
    await defaultResultPromise

    expect(uploadIndex).toBe(4)
    expect(submittedGraphs).toHaveLength(2)
    expect(submittedGraphs[1]?.['7']?.inputs['values.b']).toBe(0)
    expect(submittedGraphs[1]?.['8']?.inputs['values.b']).toBe(1)
    expect(submittedGraphs[1]?.['10']?.inputs.batch_index).toBe(1)
    expect(submittedGraphs[1]?.['13']?.inputs['values.a']).toBe(1)
  })

  it.each([
    {
      name: 'negative end trim',
      trimEndFrames: -1,
      trimStartFrames: 0,
      error: 'COMFYUI_VIDEO_SEAM_TRIM_END_FRAMES_INVALID: expected an integer between 0 and 100000',
    },
    {
      name: 'fractional start trim',
      trimEndFrames: 0,
      trimStartFrames: 1.5,
      error: 'COMFYUI_VIDEO_SEAM_TRIM_START_FRAMES_INVALID: expected an integer between 0 and 100000',
    },
    {
      name: 'over-limit end trim',
      trimEndFrames: 100_001,
      trimStartFrames: 0,
      error: 'COMFYUI_VIDEO_SEAM_TRIM_END_FRAMES_INVALID: expected an integer between 0 and 100000',
    },
  ])('rejects $name before uploading seam inputs', async ({ trimEndFrames, trimStartFrames, error }) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await expect(runComfyUiVideoSeamConcatWorkflow({
      baseUrl: 'http://127.0.0.1:8188',
      videoUrls: ['https://assets.test/shot-1.mp4', 'https://assets.test/shot-2.mp4'],
      trimEndFrames,
      trimStartFrames,
    })).rejects.toThrow(error)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('dumps resolved ComfyUI video prompts to stdout when prompt dump is enabled', async () => {
    vi.useFakeTimers()
    process.env.COMFYUI_VIDEO_PROMPT_DUMP = '1'
    workflowRoot = mkdtempSync(join(tmpdir(), 'waoowaoo-comfyui-client-'))
    process.env.COMFYUI_WORKFLOW_ROOT = workflowRoot
    writeWorkflow(workflowRoot, COMFYUI_LTX23_WORKFLOW_KEYS.singleImagePrecise, {
      '1': { class_type: 'LoadImage', inputs: { image: 'old-first.png', upload: 'image' } },
      '2': { class_type: 'PrimitiveString', inputs: { prompt: 'old global prompt' } },
      '3': { class_type: 'PrimitiveString', inputs: { prompt: 'old smart prompt' } },
      '4': {
        class_type: 'PromptRelaySmartEncode',
        inputs: {
          global_prompt: ['2', 0],
          smart_prompt: ['3', 0],
        },
      },
      '5': { class_type: 'VHS_VideoCombine', inputs: { images: ['1', 0], prompt: ['4', 0] } },
    })
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.toString()

      if (url.startsWith('https://assets.test/')) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        })
      }

      if (url.endsWith('/upload/image')) {
        return new Response(JSON.stringify({ name: 'uploaded-first.png' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.endsWith('/prompt')) {
        return new Response(JSON.stringify({ prompt_id: 'prompt-dump' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.includes('/history/prompt-dump')) {
        return new Response(JSON.stringify({
          'prompt-dump': {
            outputs: {
              '5': {
                video_url: '/view?filename=prompt-dump.mp4&type=output',
              },
            },
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.includes('/view?filename=prompt-dump.mp4')) {
        return new Response(new Uint8Array([10, 11, 12]), {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' },
        })
      }

      throw new Error(`Unexpected fetch url: ${url}`)
    })

    const resultPromise = runComfyUiVideoWorkflow({
      baseUrl: 'http://127.0.0.1:8878',
      workflowKey: COMFYUI_LTX23_WORKFLOW_KEYS.singleImagePrecise,
      prompt: 'GLOBAL: qshan office\nLOCAL: doctor pushes glasses, static camera',
      firstFrameImageUrl: 'https://assets.test/first.png',
      fps: 25,
      durationSeconds: 6,
    })

    await vi.advanceTimersByTimeAsync(1_500)
    const result = await resultPromise

    expect(result.mimeType).toBe('video/mp4')
    const output = stdoutWrite.mock.calls.map((call) => String(call[0])).join('')
    expect(output).toContain('[COMFYUI_VIDEO_PROMPT_DUMP]')
    expect(output).toContain(`workflowKey: ${COMFYUI_LTX23_WORKFLOW_KEYS.singleImagePrecise}`)
    expect(output).toContain('input_prompt:')
    expect(output).toContain('GLOBAL: qshan office')
    expect(output).toContain('promptrelay_smart:')
    expect(output).toContain('global_prompt:')
    expect(output).toContain('qshan office')
    expect(output).toContain('smart_prompt:')
    expect(output).toContain('doctor pushes glasses, static camera [0-38]')
  })
})
