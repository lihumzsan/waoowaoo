import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '@/lib/api-fetch'
import {
  projectEditBibleQueryOptions,
  type EditBibleResponse,
} from '@/lib/query/hooks/useProjectEditScript'

vi.mock('@/lib/api-fetch', () => ({
  apiFetch: vi.fn(),
}))

const apiFetchMock = vi.mocked(apiFetch)

describe('project edit Bible query cache contract', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
  })

  it('keeps the canonical wrapper when raw and selected observers refetch the same key', async () => {
    const response: EditBibleResponse = {
      editBible: {
        id: 'bible-1',
        projectId: 'project-1',
        episodeId: 'episode-1',
        sourceDocumentId: 'source-1',
        bible: null,
        beatSheet: null,
        ledger: null,
        emotionalCurve: null,
        styleBible: null,
        diagnostics: null,
        version: 1,
        status: 'confirmed',
        lockedAt: null,
        createdAt: '2026-07-10T00:00:00.000Z',
        updatedAt: '2026-07-10T00:00:00.000Z',
        stylePreviews: [],
        chapters: [],
      },
      chapters: [],
    }
    apiFetchMock.mockResolvedValue(new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const options = projectEditBibleQueryOptions('project-1', 'episode-1')
    const rawObserver = new QueryObserver(queryClient, options)
    const selectedObserver = new QueryObserver(queryClient, {
      ...options,
      select: (data) => data.editBible,
    })
    const unsubscribeRaw = rawObserver.subscribe(() => undefined)
    const unsubscribeSelected = selectedObserver.subscribe(() => undefined)

    try {
      await selectedObserver.refetch()
      expect(selectedObserver.getCurrentResult().data?.id).toBe('bible-1')
      expect(queryClient.getQueryData(options.queryKey)).toEqual(response)

      await rawObserver.refetch()
      expect(rawObserver.getCurrentResult().data).toEqual(response)
      expect(queryClient.getQueryData(options.queryKey)).toEqual(response)
    } finally {
      unsubscribeSelected()
      unsubscribeRaw()
      queryClient.clear()
    }
  })
})
