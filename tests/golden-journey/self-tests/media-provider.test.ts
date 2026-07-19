import { afterEach, describe, expect, it } from 'vitest'
import {
  queryOpenRouterVideoStatus,
  submitOpenRouterVideoTask,
} from '@/lib/ai-providers/openrouter/video'
import type { GoldenMediaServer } from '../providers/media/server'
import { startGoldenMediaServer } from '../providers/media/server'

let runningServer: GoldenMediaServer | null = null

afterEach(async () => {
  await runningServer?.close()
  runningServer = null
})

describe('Golden local media provider', () => {
  it('serves valid tiny image video and audio assets', async () => {
    runningServer = await startGoldenMediaServer()
    const [image, video, audio] = await Promise.all([
      fetch(`${runningServer.baseUrl}/assets/golden.png`),
      fetch(`${runningServer.baseUrl}/assets/golden.mp4`),
      fetch(`${runningServer.baseUrl}/assets/golden.mp3`),
    ])

    expect(image.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await image.arrayBuffer()).subarray(1, 4).toString()).toBe('PNG')
    expect(video.headers.get('content-type')).toBe('video/mp4')
    expect(Buffer.from(await video.arrayBuffer()).includes(Buffer.from('ftyp'))).toBe(true)
    expect(audio.headers.get('content-type')).toBe('audio/mpeg')
    expect((await audio.arrayBuffer()).byteLength).toBeGreaterThan(100)
  })

  it('implements FAL queue and the production OpenRouter SDK submit/status boundary', async () => {
    runningServer = await startGoldenMediaServer()
    const falSubmit = await fetch(`${runningServer.baseUrl}/openai/gpt-image-2`, { method: 'POST' })
    const falRequest = await falSubmit.json() as { request_id: string }
    const falStatus = await fetch(`${runningServer.baseUrl}/openai/gpt-image-2/requests/${falRequest.request_id}/status`)
    await expect(falStatus.json()).resolves.toMatchObject({ status: 'COMPLETED' })

    const requestId = await submitOpenRouterVideoTask({
      baseUrl: `${runningServer.baseUrl}/v1`,
      apiKey: 'golden-openrouter-key',
      payload: {
        model: 'bytedance/seedance-2.0',
        prompt: 'golden provider protocol',
        duration: 5,
        resolution: '720p',
        aspectRatio: '16:9',
      },
    })
    await expect(queryOpenRouterVideoStatus({
      baseUrl: `${runningServer.baseUrl}/v1`,
      apiKey: 'golden-openrouter-key',
      requestId,
    })).resolves.toMatchObject({
      status: 'completed',
      videoUrl: expect.stringContaining('/assets/golden.mp4'),
      downloadHeaders: { Authorization: 'Bearer golden-openrouter-key' },
    })
  })

  it('holds FAL status at the real external boundary for processing-state browser oracles', async () => {
    runningServer = await startGoldenMediaServer()
    const control = await fetch(`${runningServer.baseUrl}/__golden/media-delay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ delayMs: 50 }),
    })
    await expect(control.json()).resolves.toEqual({ ok: true, delayMs: 50 })
    const submit = await fetch(`${runningServer.baseUrl}/openai/gpt-image-2`, { method: 'POST' })
    const request = await submit.json() as { request_id: string }
    const statusUrl = `${runningServer.baseUrl}/openai/gpt-image-2/requests/${request.request_id}/status`
    await expect((await fetch(statusUrl)).json()).resolves.toEqual({ status: 'IN_PROGRESS' })
    await new Promise((resolve) => setTimeout(resolve, 60))
    await expect((await fetch(statusUrl)).json()).resolves.toMatchObject({ status: 'COMPLETED' })
  })

  it('implements the complete FAL music submission status and result protocol', async () => {
    runningServer = await startGoldenMediaServer()
    const submit = await fetch(`${runningServer.baseUrl}/fal-ai/lyria-3`, { method: 'POST' })
    const request = await submit.json() as {
      readonly request_id: string
      readonly response_url: string
      readonly status_url: string
    }

    expect(request).toEqual({
      request_id: expect.stringMatching(/^golden_fal_/),
      response_url: expect.stringContaining('/fal-results/'),
      status_url: expect.stringContaining('/fal-music/requests/'),
    })
    const status = await fetch(`${request.status_url}?logs=0`)
    await expect(status.json()).resolves.toEqual({
      status: 'COMPLETED',
      response_url: request.response_url,
    })
    const result = await fetch(request.response_url)
    await expect(result.json()).resolves.toEqual({
      audio: {
        url: `${runningServer.baseUrl}/assets/golden.mp3`,
        content_type: 'audio/mpeg',
      },
    })
  })

  it('injects an exact number of permanent FAL submission rejections', async () => {
    runningServer = await startGoldenMediaServer()
    const control = await fetch(`${runningServer.baseUrl}/__golden/fail-next-fal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ count: 2 }),
    })
    await expect(control.json()).resolves.toEqual({ ok: true, count: 2 })

    const baseUrl = runningServer.baseUrl
    const responses = await Promise.all([0, 1, 2].map(async () => await fetch(
      `${baseUrl}/openai/gpt-image-2`,
      { method: 'POST' },
    )))
    expect(responses.map((response) => response.status).sort()).toEqual([200, 422, 422])
  })

})
