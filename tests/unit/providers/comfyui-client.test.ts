import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  collectMediaRefsFromOutputs,
  resolveComfyUiPromptQueuePhase,
  runComfyUiWorkflow,
} from '@/lib/providers/comfyui/client'

describe('comfyui client media refs', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
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
})
