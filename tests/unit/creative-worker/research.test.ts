import { describe, expect, it } from 'vitest'
import {
  normalizeResearchRequest,
  projectCreativeWorkerResearchEvidence,
  recordCompletedResearchAttempt,
  recordResearchFailure,
  type CreativeWorkerResearchState,
} from '@/lib/creative-worker/research'

function state(): CreativeWorkerResearchState {
  return {
    provider: 'tavily',
    maxCalls: 4,
    usedCalls: 0,
    attempts: [],
  }
}

describe('Creative Worker external research evidence', () => {
  it('archives only query and source identity while keeping provider snippets out of evidence', () => {
    const research = state()
    research.usedCalls = 1
    recordCompletedResearchAttempt({
      state: research,
      request: normalizeResearchRequest({
        query: '规则怪谈 叙事 影像 论坛',
        includeDomains: ['zhihu.com'],
      }),
      response: {
        provider: 'tavily',
        query: '规则怪谈 叙事 影像 论坛',
        results: [{
          title: 'Community discussion',
          url: 'https://example.com/rules-horror',
          content: 'Untrusted content must remain outside evidence metadata.',
          score: 0.8,
          publishedAt: null,
        }],
      },
    })

    const evidence = projectCreativeWorkerResearchEvidence({
      locale: 'zh',
      state: research,
    })
    expect(evidence).toEqual({
      status: 'completed',
      provider: 'tavily',
      notice: null,
      budget: { maxCalls: 4, usedCalls: 1 },
      queries: [{
        ordinal: 1,
        query: '规则怪谈 叙事 影像 论坛',
        status: 'completed',
        searchDepth: 'basic',
        topic: 'general',
        sources: [{
          title: 'Community discussion',
          url: 'https://example.com/rules-horror',
        }],
      }],
    })
    expect(JSON.stringify(evidence)).not.toContain('Untrusted content')
  })

  it('distinguishes no research, unavailable research, and partial research truthfully', () => {
    const untouched = state()
    expect(projectCreativeWorkerResearchEvidence({
      locale: 'zh',
      state: untouched,
    })).toMatchObject({
      status: 'not_attempted',
      notice: expect.stringContaining('未做外部研究'),
    })

    const unavailable = state()
    unavailable.usedCalls = 1
    recordResearchFailure({
      state: unavailable,
      request: normalizeResearchRequest({ query: 'analog horror latest' }),
      status: 'unavailable',
    })
    expect(projectCreativeWorkerResearchEvidence({
      locale: 'zh',
      state: unavailable,
    })).toMatchObject({
      status: 'unavailable',
      notice: expect.stringContaining('未做外部研究'),
    })

    const partial = state()
    partial.usedCalls = 2
    recordCompletedResearchAttempt({
      state: partial,
      request: normalizeResearchRequest({ query: 'analog horror grammar' }),
      response: {
        provider: 'tavily',
        query: 'analog horror grammar',
        results: [],
      },
    })
    recordResearchFailure({
      state: partial,
      request: normalizeResearchRequest({ query: 'analog horror community' }),
      status: 'failed',
    })
    expect(projectCreativeWorkerResearchEvidence({
      locale: 'en',
      state: partial,
    })).toMatchObject({
      status: 'partial',
      notice: expect.stringContaining('partially completed'),
    })
  })
})
