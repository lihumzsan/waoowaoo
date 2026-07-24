import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { createWebSearchOperations } from '@/lib/operations/domains/web-search/web-search-ops'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { WebSearchError } from '@/lib/web-search'

function context(): ProjectAgentOperationContext {
  return {
    request: new NextRequest('http://localhost/api/project-agent'),
    userId: 'user-1',
    projectId: 'project-1',
    source: 'assistant-panel',
    context: {
      runId: 'run-1',
      executionSegmentId: 'segment-1',
      locale: 'en',
    },
  }
}

describe('Main Agent Web Search Operation', () => {
  it('returns the provider-neutral source contract through the sole search executor', async () => {
    const operation = createWebSearchOperations({
      search: async ({ request }) => ({
        provider: 'tavily',
        query: request.query,
        results: [{
          title: 'Reference',
          url: 'https://example.com/reference',
          content: 'Bounded source data.',
          score: 0.9,
          publishedAt: null,
        }],
      }),
    }).web_search
    if (!operation?.execute) throw new Error('WEB_SEARCH_EXECUTOR_REQUIRED')

    await expect(operation.execute(context(), {
      query: 'current documentary advertising grammar',
    })).resolves.toMatchObject({
      provider: 'tavily',
      query: 'current documentary advertising grammar',
      results: [{ title: 'Reference' }],
    })
  })

  it('surfaces missing or rejected configuration as an explicit typed Operation error', async () => {
    const operation = createWebSearchOperations({
      search: async () => {
        throw new WebSearchError('WEB_SEARCH_UNAVAILABLE', {
          provider: 'tavily',
          reason: 'TAVILY_API_KEY is not configured',
        })
      },
    }).web_search
    if (!operation?.execute) throw new Error('WEB_SEARCH_EXECUTOR_REQUIRED')

    await expect(operation.execute(context(), {
      query: '规则怪谈 最新 社区',
    })).rejects.toMatchObject({
      code: 'MISSING_CONFIG',
      details: {
        code: 'WEB_SEARCH_UNAVAILABLE',
        provider: 'tavily',
      },
    })
  })
})
