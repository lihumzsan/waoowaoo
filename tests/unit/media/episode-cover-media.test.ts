import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveMediaRefMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/media/service', () => ({
  resolveMediaRef: resolveMediaRefMock,
  resolveMediaRefFromLegacyValue: vi.fn(async () => null),
}))

const coverMedia = {
  id: 'media-cover-1',
  publicId: 'episode-cover/public-1',
  url: '/m/episode-cover%2Fpublic-1',
  sha256: 'cover-sha',
  mimeType: 'image/png',
  sizeBytes: 1024,
  width: 1280,
  height: 720,
  durationMs: null,
  updatedAt: '2026-07-22T00:00:00.000Z',
  storageKey: 'episode-cover/cover-1.png',
}

describe('Episode cover media attachment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveMediaRefMock.mockImplementation(async (mediaId: unknown) => (
      mediaId === coverMedia.id ? coverMedia : null
    ))
  })

  it('attaches an Episode cover media object and URL from coverImageMediaId', async () => {
    const mediaModule = await import('@/lib/media/attach')
    const attachMediaFieldsToEpisode = (
      mediaModule as unknown as Record<string, (value: Record<string, unknown>) => Promise<Record<string, unknown>>>
    ).attachMediaFieldsToEpisode

    expect(typeof attachMediaFieldsToEpisode).toBe('function')

    const result = await attachMediaFieldsToEpisode({
      id: 'episode-1',
      coverImageMediaId: coverMedia.id,
      audioMediaId: null,
      audioUrl: null,
    })

    expect(result).toMatchObject({
      id: 'episode-1',
      coverImageMediaId: coverMedia.id,
      coverImageMedia: coverMedia,
      coverImageUrl: coverMedia.url,
    })
  })

  it('attaches covers for Episodes nested in a project payload', async () => {
    const { attachMediaFieldsToProject } = await import('@/lib/media/attach')

    const result = await attachMediaFieldsToProject({
      id: 'novel-data-1',
      episodes: [
        {
          id: 'episode-1',
          coverImageMediaId: coverMedia.id,
          audioMediaId: null,
          audioUrl: null,
        },
      ],
    })

    expect(result.episodes).toEqual([
      expect.objectContaining({
        id: 'episode-1',
        coverImageMediaId: coverMedia.id,
        coverImageMedia: coverMedia,
        coverImageUrl: coverMedia.url,
      }),
    ])
  })
})
