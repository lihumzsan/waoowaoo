import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api-errors'
import { createEpisodeSourceDocument } from '@/lib/edit-source-document/service'

function writableClient() {
  return {
    projectEpisode: {
      findFirst: vi.fn(async () => ({ id: 'episode-1' })),
    },
    projectEditBible: {
      findUnique: vi.fn(async () => null),
    },
    projectEpisodeSourceDocument: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  }
}

describe('edit source document service', () => {
  it('returns ApiError INVALID_PARAMS for empty source text', async () => {
    const promise = createEpisodeSourceDocument({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      sourceKind: 'paste',
      text: '   ',
      client: writableClient() as never,
    })

    await expect(promise).rejects.toBeInstanceOf(ApiError)
    await expect(promise).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      details: expect.objectContaining({
        code: 'EDIT_SOURCE_DOCUMENT_EMPTY',
      }),
    })
  })
})
