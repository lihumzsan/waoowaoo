import { beforeEach, describe, expect, it, vi } from 'vitest'

const txMediaObjectMock = vi.hoisted(() => ({
  findUnique: vi.fn(),
  delete: vi.fn(),
}))

const transactionMock = vi.hoisted(() => vi.fn())
const deleteObjectMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: transactionMock,
  },
}))

vi.mock('@/lib/storage', () => ({
  deleteObject: deleteObjectMock,
}))

const MEDIA_OBJECT_RELATIONS = [
  'characterAppearanceImages',
  'locationImages',
  'novelPromotionCharacterVoices',
  'novelPromotionEpisodeAudios',
  'novelPromotionEpisodeCoverImages',
  'novelPromotionPanelImages',
  'novelPromotionPanelVideos',
  'novelPromotionPanelLipSyncVideos',
  'novelPromotionPanelSketchImages',
  'novelPromotionPanelPreviousImages',
  'novelPromotionShotImages',
  'supplementaryPanelImages',
  'novelPromotionVoiceLineAudios',
  'novelPromotionFreeVoiceReferenceAudios',
  'novelPromotionFreeVoiceVersionAudios',
  'voicePresetAudios',
  'globalCharacterVoices',
  'globalCharacterAppearanceImages',
  'globalCharacterAppearancePreviousImgs',
  'globalLocationImageImages',
  'globalLocationImagePreviousImages',
  'globalVoiceCustomVoices',
] as const

function relationCounts(referencedRelation?: typeof MEDIA_OBJECT_RELATIONS[number]) {
  return Object.fromEntries(MEDIA_OBJECT_RELATIONS.map((relation) => [
    relation,
    relation === referencedRelation ? 1 : 0,
  ]))
}

describe('deleteMediaObjectIfUnreferenced', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    transactionMock.mockImplementation(async (callback, options) => (
      await callback({ mediaObject: txMediaObjectMock }, options)
    ))
    txMediaObjectMock.delete.mockResolvedValue({ id: 'media-1' })
    deleteObjectMock.mockResolvedValue(undefined)
  })

  it('returns missing without deleting storage when the media row no longer exists', async () => {
    txMediaObjectMock.findUnique.mockResolvedValue(null)
    const { deleteMediaObjectIfUnreferenced } = await import('@/lib/media/unreferenced-cleanup')

    await expect(deleteMediaObjectIfUnreferenced('media-missing')).resolves.toBe('missing')

    expect(txMediaObjectMock.findUnique).toHaveBeenCalledWith({
      where: { id: 'media-missing' },
      select: { storageKey: true, _count: true },
    })
    expect(txMediaObjectMock.delete).not.toHaveBeenCalled()
    expect(deleteObjectMock).not.toHaveBeenCalled()
    expect(transactionMock).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    })
  })

  it.each(MEDIA_OBJECT_RELATIONS)(
    'returns referenced when %s still points at the media row',
    async (relation) => {
      txMediaObjectMock.findUnique.mockResolvedValue({
        storageKey: 'episode-cover/old.png',
        _count: relationCounts(relation),
      })
      const { deleteMediaObjectIfUnreferenced } = await import('@/lib/media/unreferenced-cleanup')

      await expect(deleteMediaObjectIfUnreferenced('media-1')).resolves.toBe('referenced')

      expect(txMediaObjectMock.delete).not.toHaveBeenCalled()
      expect(deleteObjectMock).not.toHaveBeenCalled()
    },
  )

  it('claims the row in a serializable transaction before deleting storage', async () => {
    const events: string[] = []
    transactionMock.mockImplementation(async (callback) => {
      events.push('transaction-start')
      const result = await callback({ mediaObject: txMediaObjectMock })
      events.push('transaction-committed')
      return result
    })
    txMediaObjectMock.findUnique.mockResolvedValue({
      storageKey: 'episode-cover/old.png',
      _count: relationCounts(),
    })
    txMediaObjectMock.delete.mockImplementation(async () => {
      events.push('media-row-deleted')
      return { id: 'media-1' }
    })
    deleteObjectMock.mockImplementation(async () => {
      events.push('storage-deleted')
    })
    const { deleteMediaObjectIfUnreferenced } = await import('@/lib/media/unreferenced-cleanup')

    await expect(deleteMediaObjectIfUnreferenced('media-1')).resolves.toBe('deleted')

    expect(txMediaObjectMock.delete).toHaveBeenCalledWith({ where: { id: 'media-1' } })
    expect(deleteObjectMock).toHaveBeenCalledWith('episode-cover/old.png')
    expect(transactionMock).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    })
    expect(events).toEqual([
      'transaction-start',
      'media-row-deleted',
      'transaction-committed',
      'storage-deleted',
    ])
  })

  it('throws a typed orphan-cleanup error with the storage key after a storage failure', async () => {
    txMediaObjectMock.findUnique.mockResolvedValue({
      storageKey: 'episode-cover/orphan.png',
      _count: relationCounts(),
    })
    const storageFailure = new Error('storage unavailable')
    deleteObjectMock.mockRejectedValue(storageFailure)
    const {
      deleteMediaObjectIfUnreferenced,
      MediaOrphanCleanupError,
    } = await import('@/lib/media/unreferenced-cleanup')

    const rejection = deleteMediaObjectIfUnreferenced('media-1')

    await expect(rejection).rejects.toBeInstanceOf(MediaOrphanCleanupError)
    await expect(rejection).rejects.toMatchObject({
      code: 'MEDIA_ORPHAN_STORAGE_CLEANUP_FAILED',
      mediaId: 'media-1',
      storageKey: 'episode-cover/orphan.png',
      cause: storageFailure,
    })
    expect(txMediaObjectMock.delete).toHaveBeenCalledTimes(1)
    expect(deleteObjectMock).toHaveBeenCalledWith('episode-cover/orphan.png')
  })
})
