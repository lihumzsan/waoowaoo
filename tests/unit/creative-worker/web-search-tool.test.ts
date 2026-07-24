import { RunContext } from '@openai/agents'
import { describe, expect, it } from 'vitest'
import { createCreativeWorkerTools } from '@/lib/creative-worker/tools'
import {
  defaultCreativeWorkerBudgets,
  type CreativeWorkerRunContext,
} from '@/lib/creative-worker/types'

function runContext(input: {
  readonly maxCalls: number
  readonly search?: CreativeWorkerRunContext['webSearch']
}): CreativeWorkerRunContext {
  return {
    locale: 'zh',
    budgets: {
      ...defaultCreativeWorkerBudgets,
      maxWebSearchCalls: input.maxCalls,
    },
    counters: {
      readCalls: 0,
      skillContentChars: 0,
      webSearchCalls: 0,
      webSearchSources: 0,
    },
    skillTrace: [],
    research: {
      provider: 'tavily',
      maxCalls: input.maxCalls,
      usedCalls: 0,
      attempts: [],
    },
    signal: new AbortController().signal,
    webSearch: input.search ?? (async ({ request }) => ({
      provider: 'tavily',
      query: request.query,
      results: [{
        title: 'Community reference',
        url: 'https://example.com/community',
        content: 'Untrusted source snippet.',
        score: 0.8,
        publishedAt: null,
      }],
    })),
  }
}

describe('Creative Direction Worker web_search tool', () => {
  it('records real source identity and refuses a provider call after the frozen budget', async () => {
    let providerCalls = 0
    const context = runContext({
      maxCalls: 1,
      search: async ({ request }) => {
        providerCalls += 1
        return {
          provider: 'tavily',
          query: request.query,
          results: [{
            title: 'Analog horror reference',
            url: 'https://example.com/analog-horror',
            content: 'Untrusted source snippet.',
            score: 0.9,
            publishedAt: null,
          }],
        }
      },
    })
    const tool = createCreativeWorkerTools({
      workerTools: ['web_search'],
    }).find((candidate) => candidate.name === 'web_search')
    if (tool?.type !== 'function') throw new Error('WEB_SEARCH_TOOL_REQUIRED')
    const agentContext = new RunContext(context)

    const completed = await tool.invoke(agentContext, JSON.stringify({
      query: '模拟恐怖 镜头 声音 叙事',
      searchDepth: 'advanced',
    }))
    const exhausted = await tool.invoke(agentContext, JSON.stringify({
      query: 'analog horror forum conventions',
    }))
    await tool.invoke(agentContext, JSON.stringify({
      query: 'a third query must not grow evidence after exhaustion',
    }))

    expect(completed).toMatchObject({
      status: 'completed',
      provider: 'tavily',
      results: [{ title: 'Analog horror reference' }],
    })
    expect(exhausted).toMatchObject({
      status: 'budget_exhausted',
      results: [],
      notice: expect.stringContaining('部分完成'),
    })
    expect(providerCalls).toBe(1)
    expect(context.counters).toMatchObject({
      webSearchCalls: 1,
      webSearchSources: 1,
    })
    expect(context.research?.attempts).toEqual([
      expect.objectContaining({
        ordinal: 1,
        status: 'completed',
        sources: [{
          title: 'Analog horror reference',
          url: 'https://example.com/analog-horror',
        }],
      }),
      expect.objectContaining({
        ordinal: 2,
        status: 'budget_exhausted',
        sources: [],
      }),
    ])
  })

  it('does not create the search tool for output kinds whose registry declaration is empty', () => {
    expect(createCreativeWorkerTools({ workerTools: [] }).map((tool) => tool.name)).toEqual([
      'read_skill',
    ])
  })
})
