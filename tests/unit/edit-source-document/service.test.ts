import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api-errors'
import {
  createEpisodeSourceDocument,
  materializePromptGeneratedSourceDocument,
} from '@/lib/edit-source-document/service'

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

  it('materializes prompt generated source text and increments the source document version', async () => {
    const client = {
      projectEpisodeSourceDocument: {
        findFirst: vi.fn(async () => ({ id: 'source-1' })),
        update: vi.fn(async () => ({
          id: 'source-1',
          episodeId: 'episode-1',
          normalizedText: '扩写后的完整剧本',
          checksum: 'checksum-expanded',
          sourceKind: 'prompt_generated_script',
          rawFileMediaId: null,
          version: 2,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:01:00Z'),
        })),
      },
    }

    const result = await materializePromptGeneratedSourceDocument({
      projectId: 'project-1',
      episodeId: 'episode-1',
      sourceDocumentId: 'source-1',
      text: '扩写后的完整剧本',
      client: client as never,
    })

    expect(client.projectEpisodeSourceDocument.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'source-1' },
      data: expect.objectContaining({
        normalizedText: '扩写后的完整剧本',
        sourceKind: 'prompt_generated_script',
        version: { increment: 1 },
      }),
    }))
    expect(result.version).toBe(2)
    expect(result.sourceKind).toBe('prompt_generated_script')
  })
})
