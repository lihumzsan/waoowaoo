import fs from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const recordFindFirstMock = vi.hoisted(() => vi.fn())
const recordFindUniqueMock = vi.hoisted(() => vi.fn())
const recordDeleteMock = vi.hoisted(() => vi.fn())
const versionFindManyMock = vi.hoisted(() => vi.fn())
const versionDeleteManyMock = vi.hoisted(() => vi.fn())
const taskFindFirstMock = vi.hoisted(() => vi.fn())
const mediaFindManyMock = vi.hoisted(() => vi.fn())
const mediaDeleteManyMock = vi.hoisted(() => vi.fn())
const deleteObjectsMock = vi.hoisted(() => vi.fn())
const resolveStorageKeyMock = vi.hoisted(() => vi.fn())
const deleteMediaObjectIfUnreferencedMock = vi.hoisted(() => vi.fn())
const logErrorMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    novelPromotionFreeVoiceRecord: {
      findFirst: recordFindFirstMock,
      findUnique: recordFindUniqueMock,
      delete: recordDeleteMock,
    },
    novelPromotionFreeVoiceVersion: {
      findMany: versionFindManyMock,
      deleteMany: versionDeleteManyMock,
    },
    task: {
      findFirst: taskFindFirstMock,
    },
    mediaObject: {
      findMany: mediaFindManyMock,
      deleteMany: mediaDeleteManyMock,
    },
  },
}))

vi.mock('@/lib/storage', () => ({
  deleteObjects: deleteObjectsMock,
  extractStorageKey: (value: string) => value,
  getSignedUrl: (key: string) => `signed:${key}`,
  toFetchableUrl: (value: string) => value,
  uploadObject: vi.fn(),
}))

vi.mock('@/lib/media/service', () => ({
  ensureMediaObjectFromStorageKey: vi.fn(),
  resolveStorageKeyFromMediaValue: resolveStorageKeyMock,
}))

vi.mock('@/lib/media/unreferenced-cleanup', () => ({
  deleteMediaObjectIfUnreferenced: deleteMediaObjectIfUnreferencedMock,
}))

vi.mock('@/lib/logging/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/logging/core')>(),
  logError: logErrorMock,
}))

describe('project free voice cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    taskFindFirstMock.mockResolvedValue(null)
    versionFindManyMock.mockResolvedValue([
      { id: 'version-1' },
      { id: 'version-2' },
      { id: 'version-3' },
    ])
    recordDeleteMock.mockResolvedValue({ id: 'record-1' })
    versionDeleteManyMock.mockResolvedValue({ count: 2 })
    recordFindUniqueMock.mockResolvedValue({
      id: 'record-1',
      versions: [{ id: 'version-1' }],
    })
    resolveStorageKeyMock.mockResolvedValue('voice/free/shared.wav')
    deleteObjectsMock.mockResolvedValue({ success: 1, failed: 0 })
    deleteMediaObjectIfUnreferencedMock.mockResolvedValue('deleted')
    mediaFindManyMock.mockImplementation(async ({ where }) => (
      where.id.in.map((id: string) => ({ id, _count: {} }))
    ))
  })

  it('collects every generated free voice audio before project deletion', () => {
    const source = fs.readFileSync('src/app/api/projects/[projectId]/route.ts', 'utf8')
    expect(source).toContain('freeVoiceRecords')
    expect(source).toMatch(/freeVoiceRecords[\s\S]*versions/)
    expect(source).toMatch(/version\.audioUrl/)
    expect(source).toMatch(/resolveStorageKeyFromMediaValue\(version\.audioUrl\)/)
  })

  it('deletes the Free Voice record relation before preserving media referenced by an Episode cover', async () => {
    const events: string[] = []
    recordFindFirstMock.mockResolvedValueOnce({
      id: 'record-1',
      versions: [{
        id: 'version-1',
        audioUrl: '/m/shared',
        audioMediaId: 'media-shared-cover',
      }],
    })
    recordDeleteMock.mockImplementationOnce(async () => {
      events.push('record-deleted')
      return { id: 'record-1' }
    })
    mediaFindManyMock.mockResolvedValueOnce([{
      id: 'media-shared-cover',
      _count: { novelPromotionEpisodeCoverImages: 1 },
    }])
    deleteMediaObjectIfUnreferencedMock.mockImplementationOnce(async () => {
      events.push('guarded-cleanup-referenced')
      return 'referenced'
    })

    const { deleteFreeVoiceRecord } = await import('@/lib/voice/free-voice')
    await expect(deleteFreeVoiceRecord({
      projectId: 'project-1',
      recordId: 'record-1',
    })).resolves.toEqual({ deleted: true })

    expect(recordDeleteMock).toHaveBeenCalledWith({ where: { id: 'record-1' } })
    expect(deleteMediaObjectIfUnreferencedMock).toHaveBeenCalledWith('media-shared-cover')
    expect(deleteObjectsMock).not.toHaveBeenCalled()
    expect(mediaFindManyMock).not.toHaveBeenCalled()
    expect(mediaDeleteManyMock).not.toHaveBeenCalled()
    expect(events).toEqual([
      'record-deleted',
      'guarded-cleanup-referenced',
    ])
  })

  it('deletes removed version relations before deduplicated guarded media cleanup', async () => {
    const events: string[] = []
    recordFindFirstMock.mockResolvedValueOnce({
      id: 'record-1',
      versions: [
        {
          id: 'version-kept',
          audioUrl: '/m/kept',
          audioMediaId: 'media-kept',
        },
        {
          id: 'version-removed-1',
          audioUrl: '/m/removed-1',
          audioMediaId: 'media-removed',
        },
        {
          id: 'version-removed-2',
          audioUrl: '/m/removed-2',
          audioMediaId: 'media-removed',
        },
      ],
    })
    versionDeleteManyMock.mockImplementationOnce(async () => {
      events.push('versions-deleted')
      return { count: 2 }
    })
    deleteMediaObjectIfUnreferencedMock.mockImplementationOnce(async () => {
      events.push('guarded-cleanup')
      return 'deleted'
    })

    const { keepOnlyFreeVoiceVersion } = await import('@/lib/voice/free-voice')
    await keepOnlyFreeVoiceVersion({
      projectId: 'project-1',
      recordId: 'record-1',
      versionId: 'version-kept',
    })

    expect(versionDeleteManyMock).toHaveBeenCalledWith({
      where: { recordId: 'record-1', id: { not: 'version-kept' } },
    })
    expect(deleteMediaObjectIfUnreferencedMock).toHaveBeenCalledTimes(1)
    expect(deleteMediaObjectIfUnreferencedMock).toHaveBeenCalledWith('media-removed')
    expect(deleteObjectsMock).not.toHaveBeenCalled()
    expect(events).toEqual([
      'versions-deleted',
      'guarded-cleanup',
    ])
  })

  it('logs guarded cleanup errors and keeps the committed Free Voice deletion successful', async () => {
    recordFindFirstMock.mockResolvedValueOnce({
      id: 'record-1',
      versions: [
        {
          id: 'version-1',
          audioUrl: '/m/one',
          audioMediaId: 'media-1',
        },
        {
          id: 'version-2',
          audioUrl: '/m/two',
          audioMediaId: 'media-2',
        },
      ],
    })
    deleteMediaObjectIfUnreferencedMock
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce('deleted')

    const { deleteFreeVoiceRecord } = await import('@/lib/voice/free-voice')
    await expect(deleteFreeVoiceRecord({
      projectId: 'project-1',
      recordId: 'record-1',
    })).resolves.toEqual({ deleted: true })

    expect(deleteMediaObjectIfUnreferencedMock).toHaveBeenNthCalledWith(1, 'media-1')
    expect(deleteMediaObjectIfUnreferencedMock).toHaveBeenNthCalledWith(2, 'media-2')
    expect(logErrorMock).toHaveBeenCalledWith(
      'Free Voice media cleanup failed after relation deletion',
      expect.objectContaining({
        projectId: 'project-1',
        recordId: 'record-1',
        mediaId: 'media-1',
        error: 'storage unavailable',
      }),
    )
  })
})
