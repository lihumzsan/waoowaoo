import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mediaObjectMock = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { mediaObject: mediaObjectMock } }))
vi.mock('@/lib/storage', () => ({ extractStorageKey: (value: string) => value }))

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

describe('Episode cover media attachment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mediaObjectMock.findMany.mockResolvedValue([coverMedia, audioMedia, secondCoverMedia])
    mediaObjectMock.findUnique.mockImplementation(async (args: { where?: { id?: string; storageKey?: string } }) => {
      if (args.where?.id === coverMedia.id) return coverMedia
      if (args.where?.id === audioMedia.id) return audioMedia
      if (args.where?.id === secondCoverMedia.id) return secondCoverMedia
      if (args.where?.storageKey === legacyAudioMedia.storageKey) return legacyAudioMedia
      return null
    })
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

  it('loads unique Episode audio and cover media in one batch while preserving unresolved legacy audio fallback', async () => {
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
        audioMediaId: null,
        audioUrl: legacyAudioMedia.storageKey,
        coverImageMediaId: secondCoverMedia.id,
      },
      {
        id: 'episode-4',
        audioMediaId: null,
        audioUrl: null,
        coverImageMediaId: 'missing-cover-media',
        coverImageUrl: 'https://legacy.example/cover.png',
      },
    ])

    expect(mediaObjectMock.findMany).toHaveBeenCalledTimes(1)
    expect(mediaObjectMock.findMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: [audioMedia.id, coverMedia.id, secondCoverMedia.id, 'missing-cover-media'],
        },
      },
    })
    expect(mediaObjectMock.findUnique).toHaveBeenCalledTimes(1)
    expect(mediaObjectMock.findUnique).toHaveBeenCalledWith({
      where: { storageKey: legacyAudioMedia.storageKey },
    })
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
        audioMedia: null,
        audioUrl: null,
        coverImageMedia: null,
        coverImageUrl: null,
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
