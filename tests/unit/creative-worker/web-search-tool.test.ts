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
      provider: 'openai',
      maxCalls: input.maxCalls,
      usedCalls: 0,
      attempts: [],
    },
    signal: new AbortController().signal,
    webSearch: input.search ?? (async ({ request }) => ({
      provider: 'openai',
      query: request.query,
      report: 'Evidence-grounded community research.',
      queries: ['community research query'],
      sources: [{
        title: 'Community reference',
        url: 'https://example.com/community',
      }],
      images: [],
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
          provider: 'openai',
          query: request.query,
          report: 'Analog horror is organized around evidentiary media.',
          queries: ['analog horror primary examples'],
          sources: [{
            title: 'Analog horror reference',
            url: 'https://example.com/analog-horror',
          }],
          images: [],
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
    }))
    const exhausted = await tool.invoke(agentContext, JSON.stringify({
      query: 'analog horror forum conventions',
    }))
    await tool.invoke(agentContext, JSON.stringify({
      query: 'a third query must not grow evidence after exhaustion',
    }))

    expect(completed).toMatchObject({
      status: 'completed',
      provider: 'openai',
      report: 'Analog horror is organized around evidentiary media.',
      queries: ['analog horror primary examples'],
      sources: [{ title: 'Analog horror reference' }],
    })
    expect(exhausted).toMatchObject({
      status: 'budget_exhausted',
      sources: [],
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
        providerQueries: ['analog horror primary examples'],
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
