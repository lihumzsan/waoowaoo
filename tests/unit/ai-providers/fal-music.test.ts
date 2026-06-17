import { beforeEach, describe, expect, it, vi } from 'vitest'

const getProviderConfigMock = vi.hoisted(() => vi.fn(async () => ({
  id: 'fal',
  name: 'fal',
  apiKey: 'fal-key',
})))

const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/user-api/runtime-config', () => ({
  getProviderConfig: getProviderConfigMock,
}))

import { executeFalMusicGeneration } from '@/lib/ai-providers/fal/music'

function readSubmittedJson(): unknown {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
  return JSON.parse(String(init?.body || '{}')) as unknown
}

describe('fal music generation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('submits Lyria 3 Pro music prompts and returns the completed audio URL', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ request_id: 'req-music-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'COMPLETED',
        response_url: 'https://queue.fal.run/fal-ai/lyria3/pro/requests/req-music-1',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        audio: {
          url: 'https://cdn.example.com/music.mp3',
          content_type: 'audio/mpeg',
        },
        lyrics: 'instrumental',
      }), { status: 200 }))

    const result = await executeFalMusicGeneration({
      userId: 'user-1',
      selection: {
        provider: 'fal',
        modelId: 'fal-ai/lyria3/pro',
        modelKey: 'fal::fal-ai/lyria3/pro',
        variantSubKind: 'official',
      },
      prompt: 'quiet tension cue',
      options: {
        durationSeconds: 60,
        vocalMode: 'instrumental',
        genre: 'cinematic',
        mood: 'tense',
        bpm: 92,
        outputFormat: 'mp3',
      },
    })

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://queue.fal.run/fal-ai/lyria3/pro', expect.objectContaining({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Key fal-key',
      },
    }))
    expect(readSubmittedJson()).toEqual({
      prompt: [
        'quiet tension cue',
        'Genre: cinematic',
        'Mood: tense',
        'Target duration: 60 seconds',
        'BPM: 92',
        'Instrumental only. Do not include vocals or lyrics.',
        'Output format: mp3',
      ].join('\n'),
    })
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://queue.fal.run/fal-ai/lyria3/pro/requests/req-music-1/status?logs=0', expect.objectContaining({
      method: 'GET',
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(3, 'https://queue.fal.run/fal-ai/lyria3/pro/requests/req-music-1', expect.objectContaining({
      method: 'GET',
    }))
    expect(result).toEqual({
      success: true,
      audioUrl: 'https://cdn.example.com/music.mp3',
      audioMimeType: 'audio/mpeg',
      metadata: {
        model: 'fal-ai/lyria3/pro',
        requestId: 'req-music-1',
        lyrics: 'instrumental',
      },
    })
  })

  it('fails explicitly when Lyria returns a completed response without audio', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ request_id: 'req-music-2' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'COMPLETED' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ lyrics: 'missing audio' }), { status: 200 }))

    await expect(executeFalMusicGeneration({
      userId: 'user-1',
      selection: {
        provider: 'fal',
        modelId: 'fal-ai/lyria3/pro',
        modelKey: 'fal::fal-ai/lyria3/pro',
        variantSubKind: 'official',
      },
      prompt: 'quiet tension cue',
      options: {},
    })).rejects.toThrow('FAL_MUSIC_RESULT_AUDIO_MISSING')
  })
})
