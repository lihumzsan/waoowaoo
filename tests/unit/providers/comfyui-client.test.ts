import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  collectMediaRefsFromOutputs,
  resolveComfyUiPromptQueuePhase,
  runComfyUiImageWorkflow,
  runComfyUiWorkflow,
} from '@/lib/providers/comfyui/client'

function writeWorkflow(root: string, workflowKey: string, workflow: unknown) {
  const filePath = join(root, `${workflowKey}.json`.replace(/\//g, '\\'))
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(workflow), 'utf-8')
}

describe('comfyui client media refs', () => {
  let workflowRoot: string | null = null

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete process.env.COMFYUI_WORKFLOW_ROOT
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
})
