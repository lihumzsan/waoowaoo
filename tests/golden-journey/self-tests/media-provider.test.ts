import { afterEach, describe, expect, it } from 'vitest'
import type { GoldenMediaServer } from '../providers/media/server'
import { startGoldenMediaServer } from '../providers/media/server'

let runningServer: GoldenMediaServer | null = null

afterEach(async () => {
  await runningServer?.close()
  runningServer = null
  delete process.env.GOLDEN_MEDIA_SCENARIO
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

  it('implements FAL queue and OpenRouter video terminal protocols', async () => {
    runningServer = await startGoldenMediaServer()
    const falSubmit = await fetch(`${runningServer.baseUrl}/openai/gpt-image-2`, { method: 'POST' })
    const falRequest = await falSubmit.json() as { request_id: string }
    const falStatus = await fetch(`${runningServer.baseUrl}/openai/gpt-image-2/requests/${falRequest.request_id}/status`)
    await expect(falStatus.json()).resolves.toMatchObject({ status: 'COMPLETED' })

    const videoSubmit = await fetch(`${runningServer.baseUrl}/v1/videos`, { method: 'POST' })
    const videoRequest = await videoSubmit.json() as { id: string }
    const videoStatus = await fetch(`${runningServer.baseUrl}/v1/videos/${videoRequest.id}`)
    await expect(videoStatus.json()).resolves.toMatchObject({
      status: 'completed',
      unsigned_urls: [expect.stringContaining('/assets/golden.mp4')],
    })
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

  it('injects one retryable failure and then returns to the real local protocol', async () => {
    process.env.GOLDEN_MEDIA_SCENARIO = 'retry-once'
    runningServer = await startGoldenMediaServer()
    const first = await fetch(`${runningServer.baseUrl}/openai/gpt-image-2`, { method: 'POST' })
    const second = await fetch(`${runningServer.baseUrl}/openai/gpt-image-2`, { method: 'POST' })
    expect(first.status).toBe(503)
    expect(second.status).toBe(200)
  })

  it('injects a declared terminal provider response without fabricating media', async () => {
    process.env.GOLDEN_MEDIA_SCENARIO = 'terminal-failure'
    runningServer = await startGoldenMediaServer()
    const response = await fetch(`${runningServer.baseUrl}/openai/gpt-image-2`, { method: 'POST' })
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({ error: 'GOLDEN_LOCAL_PROVIDER_TERMINAL_FAILURE' })
  })

  it('switches a running provider at the real external boundary for checkpoint variants', async () => {
    runningServer = await startGoldenMediaServer()
    const retryControl = await fetch(`${runningServer.baseUrl}/__golden/media-control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario: 'retry-once' }),
    })
    await expect(retryControl.json()).resolves.toEqual({ ok: true, scenario: 'retry-once' })
    expect((await fetch(`${runningServer.baseUrl}/openai/gpt-image-2`, { method: 'POST' })).status).toBe(503)
    expect((await fetch(`${runningServer.baseUrl}/openai/gpt-image-2`, { method: 'POST' })).status).toBe(200)

    const terminalControl = await fetch(`${runningServer.baseUrl}/__golden/media-control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario: 'terminal-failure' }),
    })
    await expect(terminalControl.json()).resolves.toEqual({ ok: true, scenario: 'terminal-failure' })
    expect((await fetch(`${runningServer.baseUrl}/openai/gpt-image-2`, { method: 'POST' })).status).toBe(422)
  })
})
