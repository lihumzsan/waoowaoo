import { afterEach, describe, expect, it } from 'vitest'
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

})
