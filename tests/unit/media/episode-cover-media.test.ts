import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mediaObjectMock = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { mediaObject: mediaObjectMock } }))
vi.mock('@/lib/storage', () => ({
  extractStorageKey: (value: string) => {
    if (value.startsWith('/api/files/')) {
      return decodeURIComponent(value.replace('/api/files/', ''))
    }
    if (value.startsWith('http://') || value.startsWith('https://')) {
      const parsed = new URL(value)
      return parsed.pathname.replace(/^\/media-bucket\//, '')
    }
    return value
  },
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

const audioMedia = {
  id: 'media-audio-1',
  publicId: 'episode-audio/public-1',
  url: '/m/episode-audio%2Fpublic-1',
  sha256: 'audio-sha',
  mimeType: 'audio/mpeg',
  sizeBytes: 2048,
  width: null,
  height: null,
  durationMs: 1200,
  updatedAt: '2026-07-22T00:00:00.000Z',
  storageKey: 'episode-audio/audio-1.mp3',
}

const secondCoverMedia = {
  ...coverMedia,
  id: 'media-cover-2',
  publicId: 'episode-cover/public-2',
  url: '/m/episode-cover%2Fpublic-2',
  storageKey: 'episode-cover/cover-2.png',
}

const legacyAudioMedia = {
  ...audioMedia,
  id: 'media-legacy-audio',
  publicId: 'episode-audio/legacy',
  url: '/m/episode-audio%2Flegacy',
  storageKey: 'episode-audio/legacy.mp3',
}

const missingLegacyAudioMedia = {
  ...audioMedia,
  id: 'media-missing-legacy-audio',
  publicId: 'episode-audio/missing-legacy',
  url: '/m/episode-audio%2Fmissing-legacy',
  storageKey: 'episode-audio/missing-legacy.mp3',
}

describe('Episode cover media attachment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mediaObjectMock.findMany.mockImplementation(async (args: {
      where?: {
        id?: { in?: string[] }
        storageKey?: { in?: string[] }
      }
    }) => {
      const ids = args.where?.id?.in || []
      if (ids.length > 0) {
        return [coverMedia, audioMedia, secondCoverMedia].filter((media) => ids.includes(media.id))
      }
      const storageKeys = args.where?.storageKey?.in || []
      return storageKeys.includes(legacyAudioMedia.storageKey) ? [legacyAudioMedia] : []
    })
    mediaObjectMock.findUnique.mockImplementation(async (args: { where?: { id?: string; storageKey?: string } }) => {
      if (args.where?.id === coverMedia.id) return coverMedia
      if (args.where?.id === audioMedia.id) return audioMedia
      if (args.where?.id === secondCoverMedia.id) return secondCoverMedia
      if (args.where?.storageKey === legacyAudioMedia.storageKey) return legacyAudioMedia
      return null
    })
    mediaObjectMock.upsert.mockResolvedValue(missingLegacyAudioMedia)
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

  it('batches duplicate modern Episode media IDs nested in a project payload', async () => {
    const { attachMediaFieldsToProject } = await import('@/lib/media/attach')

    const result = await attachMediaFieldsToProject({
      id: 'novel-data-1',
      episodes: [
        {
          id: 'episode-1',
          coverImageMediaId: coverMedia.id,
          audioMediaId: audioMedia.id,
          audioUrl: 'episode-audio/legacy-should-not-win.mp3',
        },
        {
          id: 'episode-2',
          coverImageMediaId: coverMedia.id,
          audioMediaId: audioMedia.id,
          audioUrl: 'episode-audio/legacy-should-not-win.mp3',
        },
      ],
    })

    expect(mediaObjectMock.findMany).toHaveBeenCalledTimes(1)
    expect(mediaObjectMock.findMany).toHaveBeenCalledWith({
      where: { id: { in: [audioMedia.id, coverMedia.id] } },
    })
    expect(mediaObjectMock.findUnique).not.toHaveBeenCalled()
    expect(result.episodes).toHaveLength(2)
    expect(result.episodes[0]).toMatchObject({
      audioMedia: expect.objectContaining({ id: audioMedia.id }),
      audioUrl: audioMedia.url,
      coverImageMedia: expect.objectContaining({ id: coverMedia.id }),
      coverImageUrl: coverMedia.url,
    })
  })

  it('batches modern IDs and normalized existing legacy audio keys while preserving fallbacks', async () => {
    const mediaModule = await import('@/lib/media/attach')
    const attachMediaFieldsToEpisodes = (
      mediaModule as unknown as {
        attachMediaFieldsToEpisodes: (episodes: Array<Record<string, unknown>>) => Promise<Array<Record<string, unknown>>>
      }
    ).attachMediaFieldsToEpisodes

    const result = await attachMediaFieldsToEpisodes([
      {
        id: 'episode-1',
        audioMediaId: audioMedia.id,
        audioUrl: 'episode-audio/audio-1.mp3',
        coverImageMediaId: coverMedia.id,
      },
      {
        id: 'episode-2',
        audioMediaId: audioMedia.id,
        audioUrl: 'episode-audio/audio-1.mp3',
        coverImageMediaId: coverMedia.id,
      },
      {
        id: 'episode-3',
        audioMediaId: 'missing-modern-audio',
        audioUrl: legacyAudioMedia.storageKey,
        coverImageMediaId: secondCoverMedia.id,
      },
      {
        id: 'episode-4',
        audioMediaId: null,
        audioUrl: '/api/files/%2Fepisode-audio%2Flegacy.mp3',
        coverImageMediaId: null,
      },
      {
        id: 'episode-5',
        audioMediaId: null,
        audioUrl: 'https://storage.example/media-bucket/episode-audio/legacy.mp3?signature=abc',
        coverImageMediaId: null,
      },
      {
        id: 'episode-6',
        audioMediaId: null,
        audioUrl: '/legacy/local-only.mp3',
        coverImageMediaId: 'missing-cover-media',
        coverImageUrl: 'https://legacy.example/cover.png',
      },
    ])

    expect(mediaObjectMock.findMany).toHaveBeenCalledTimes(2)
    expect(mediaObjectMock.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: {
          in: [
            audioMedia.id,
            coverMedia.id,
            'missing-modern-audio',
            secondCoverMedia.id,
            'missing-cover-media',
          ],
        },
      },
    })
    expect(mediaObjectMock.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        storageKey: {
          in: [legacyAudioMedia.storageKey],
        },
      },
    })
    expect(mediaObjectMock.findUnique).not.toHaveBeenCalled()
    expect(mediaObjectMock.upsert).not.toHaveBeenCalled()
    expect(result).toEqual([
      expect.objectContaining({
        id: 'episode-1',
        audioMedia: expect.objectContaining({ id: audioMedia.id, url: audioMedia.url }),
        audioUrl: audioMedia.url,
        coverImageMedia: expect.objectContaining({ id: coverMedia.id, url: coverMedia.url }),
        coverImageUrl: coverMedia.url,
      }),
      expect.objectContaining({
        id: 'episode-2',
        audioMedia: expect.objectContaining({ id: audioMedia.id, url: audioMedia.url }),
        coverImageMedia: expect.objectContaining({ id: coverMedia.id, url: coverMedia.url }),
      }),
      expect.objectContaining({
        id: 'episode-3',
        audioMedia: expect.objectContaining({ id: legacyAudioMedia.id, url: legacyAudioMedia.url }),
        audioUrl: legacyAudioMedia.url,
        coverImageMedia: expect.objectContaining({ id: secondCoverMedia.id, url: secondCoverMedia.url }),
        coverImageUrl: secondCoverMedia.url,
      }),
      expect.objectContaining({
        id: 'episode-4',
        audioMedia: expect.objectContaining({ id: legacyAudioMedia.id, url: legacyAudioMedia.url }),
        audioUrl: legacyAudioMedia.url,
        coverImageMedia: null,
        coverImageUrl: null,
      }),
      expect.objectContaining({
        id: 'episode-5',
        audioMedia: expect.objectContaining({ id: legacyAudioMedia.id, url: legacyAudioMedia.url }),
        audioUrl: legacyAudioMedia.url,
        coverImageMedia: null,
        coverImageUrl: null,
      }),
      expect.objectContaining({
        id: 'episode-6',
        audioMedia: null,
        audioUrl: '/legacy/local-only.mp3',
        coverImageMedia: null,
        coverImageUrl: null,
      }),
    ])
  })

  it('ensures one missing legacy audio object per normalized key and reuses it', async () => {
    const { attachMediaFieldsToEpisodes } = await import('@/lib/media/attach')

    const result = await attachMediaFieldsToEpisodes([
      {
        id: 'episode-1',
        audioMediaId: null,
        audioUrl: missingLegacyAudioMedia.storageKey,
        coverImageMediaId: null,
      },
      {
        id: 'episode-2',
        audioMediaId: null,
        audioUrl: '/api/files/%2Fepisode-audio%2Fmissing-legacy.mp3',
        coverImageMediaId: null,
      },
    ])

    expect(mediaObjectMock.findMany).toHaveBeenCalledTimes(1)
    expect(mediaObjectMock.findMany).toHaveBeenCalledWith({
      where: {
        storageKey: {
          in: [missingLegacyAudioMedia.storageKey],
        },
      },
    })
    expect(mediaObjectMock.findUnique).toHaveBeenCalledTimes(1)
    expect(mediaObjectMock.findUnique).toHaveBeenCalledWith({
      where: { storageKey: missingLegacyAudioMedia.storageKey },
    })
    expect(mediaObjectMock.upsert).toHaveBeenCalledTimes(1)
    expect(result[0]?.audioMedia).toEqual(result[1]?.audioMedia)
    expect(result).toEqual([
      expect.objectContaining({
        id: 'episode-1',
        audioMedia: expect.objectContaining({ id: missingLegacyAudioMedia.id }),
        audioUrl: missingLegacyAudioMedia.url,
      }),
      expect.objectContaining({
        id: 'episode-2',
        audioMedia: expect.objectContaining({ id: missingLegacyAudioMedia.id }),
        audioUrl: missingLegacyAudioMedia.url,
      }),
    ])
  })

  it.each(['schema.prisma', 'schema.sqlit.prisma'])(
    '%s keeps the Episode cover relation visible to MediaObject reference counts',
    (schemaName) => {
      const schema = fs.readFileSync(path.join(process.cwd(), 'prisma', schemaName), 'utf8')

      expect(schema).toContain(
        'coverImageMedia         MediaObject?               @relation("NovelPromotionEpisodeCoverImageMedia", fields: [coverImageMediaId], references: [id], onDelete: SetNull)',
      )
      expect(schema).toContain(
        'novelPromotionEpisodeCoverImages      NovelPromotionEpisode[]     @relation("NovelPromotionEpisodeCoverImageMedia")',
      )
    },
  )
})
