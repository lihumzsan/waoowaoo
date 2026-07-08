import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveDefaultEditChapter } from '@/lib/edit-chapter/service'

const prismaMock = vi.hoisted(() => ({
  projectEditChapter: {
    findMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

describe('resolveDefaultEditChapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves the single canonical chapter for a one-chapter episode', async () => {
    prismaMock.projectEditChapter.findMany.mockResolvedValueOnce([{
      id: 'chapter-0',
      episodeId: 'episode-1',
      chapterIndex: 0,
    }])

    await expect(resolveDefaultEditChapter('episode-1')).resolves.toEqual({
      id: 'chapter-0',
      episodeId: 'episode-1',
      chapterIndex: 0,
    })
  })

  it('fails explicitly instead of treating the default chapter as the whole episode when multiple chapters exist', async () => {
    prismaMock.projectEditChapter.findMany.mockResolvedValueOnce([
      { id: 'chapter-0', episodeId: 'episode-1', chapterIndex: 0 },
      { id: 'chapter-1', episodeId: 'episode-1', chapterIndex: 1 },
    ])

    await expect(resolveDefaultEditChapter('episode-1'))
      .rejects.toThrow('DEFAULT_CHAPTER_FOR_MULTI_CHAPTER_EPISODE_FORBIDDEN:episode-1')
  })
})
