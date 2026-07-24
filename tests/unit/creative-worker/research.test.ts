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
    provider: 'openai',
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
        allowedDomains: ['zhihu.com'],
      }),
      response: {
        provider: 'openai',
        query: '规则怪谈 叙事 影像 论坛',
        report: 'A synthesized report that must remain outside evidence metadata.',
        queries: ['规则怪谈 起源 A岛', 'site:zhihu.com 规则怪谈 社区用法'],
        sources: [{
          title: 'Community discussion',
          url: 'https://example.com/rules-horror',
        }],
      },
    })

    const evidence = projectCreativeWorkerResearchEvidence({
      locale: 'zh',
      state: research,
    })
    expect(evidence).toEqual({
      status: 'completed',
      provider: 'openai',
      notice: null,
      budget: { maxCalls: 4, usedCalls: 1 },
      queries: [{
        ordinal: 1,
        query: '规则怪谈 叙事 影像 论坛',
        status: 'completed',
        providerQueries: ['规则怪谈 起源 A岛', 'site:zhihu.com 规则怪谈 社区用法'],
        sources: [{
          title: 'Community discussion',
          url: 'https://example.com/rules-horror',
        }],
      }],
    })
    expect(JSON.stringify(evidence)).not.toContain('synthesized report')
  })

  it('distinguishes no research, unavailable research, and partial research truthfully', () => {
    const untouched = state()
    expect(projectCreativeWorkerResearchEvidence({
      locale: 'zh',
      state: untouched,
    })).toMatchObject({
      status: 'not_attempted',
      notice: null,
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
        provider: 'openai',
        query: 'analog horror grammar',
        report: 'Research report.',
        queries: ['analog horror grammar'],
        sources: [{
          title: 'Primary reference',
          url: 'https://example.com/primary',
        }],
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
