import { z } from 'zod'
import type { Locale } from '@/i18n/routing'
import type { WebSearchRequest, WebSearchResponse } from '@/lib/web-search'
import { CREATIVE_WORKER_HARD_LIMITS } from './constants'

export const creativeWorkerResearchAttemptSchema = z.object({
  ordinal: z.number().int().positive(),
  query: z.string().trim().min(1).max(1_000),
  status: z.enum(['completed', 'unavailable', 'failed', 'budget_exhausted']),
  providerQueries: z.array(z.string().trim().min(1).max(1_000)).max(32),
  sources: z.array(z.object({
    title: z.string().trim().min(1).max(500),
    url: z.string().url().max(2_000),
  }).strict()).max(32),
}).strict()

export const creativeWorkerResearchEvidenceSchema = z.object({
  status: z.enum([
    'not_attempted',
    'completed',
    'partial',
    'unavailable',
    'failed',
    'budget_exhausted',
  ]),
  provider: z.literal('openai'),
  notice: z.string().trim().min(1).max(2_000).nullable(),
  budget: z.object({
    maxCalls: z.number().int().positive(),
    usedCalls: z.number().int().nonnegative(),
  }).strict(),
  queries: z.array(creativeWorkerResearchAttemptSchema)
    .max(CREATIVE_WORKER_HARD_LIMITS.maxWebSearchCalls + 1),
}).strict().superRefine((evidence, context) => {
  if (evidence.budget.usedCalls > evidence.budget.maxCalls) {
    context.addIssue({
      code: 'custom',
      message: 'CREATIVE_WORK_RESEARCH_BUDGET_INVALID',
      path: ['budget', 'usedCalls'],
    })
  }
})

export type CreativeWorkerResearchAttempt = z.infer<typeof creativeWorkerResearchAttemptSchema>
export type CreativeWorkerResearchEvidence = z.infer<typeof creativeWorkerResearchEvidenceSchema>

export interface CreativeWorkerResearchState {
  readonly provider: 'openai'
  readonly maxCalls: number
  usedCalls: number
  readonly attempts: CreativeWorkerResearchAttempt[]
}

function localizedNotice(
  locale: Locale,
  status: CreativeWorkerResearchEvidence['status'],
): string | null {
  if (status === 'completed' || status === 'not_attempted') return null
  if (locale === 'zh') {
    if (status === 'partial') return '外部研究仅部分完成；制作方向只使用已归档来源，并明确保留未验证项。'
    if (status === 'budget_exhausted') return '未做外部研究：联网检索预算已耗尽。'
    if (status === 'unavailable') return '未做外部研究：联网检索未配置或当前不可用。'
    return '未做外部研究：联网检索失败，未把推测伪装成检索结论。'
  }
  if (status === 'partial') {
    return 'External research was only partially completed; the direction uses only archived sources and preserves unverified points.'
  }
  if (status === 'budget_exhausted') return 'External research was not performed: the web-search budget was exhausted.'
  if (status === 'unavailable') return 'External research was not performed: web search was not configured or unavailable.'
  return 'External research was not performed: web search failed, and assumptions were not presented as findings.'
}

export function normalizeResearchRequest(
  request: WebSearchRequest,
): Required<Pick<WebSearchRequest, 'query' | 'allowedDomains'>> & WebSearchRequest {
  return {
    ...request,
    query: request.query.trim(),
    allowedDomains: request.allowedDomains ?? [],
  }
}

export function recordCompletedResearchAttempt(input: {
  readonly state: CreativeWorkerResearchState
  readonly request: ReturnType<typeof normalizeResearchRequest>
  readonly response: WebSearchResponse
}): CreativeWorkerResearchAttempt {
  const attempt: CreativeWorkerResearchAttempt = {
    ordinal: input.state.attempts.length + 1,
    query: input.request.query,
    status: 'completed',
    providerQueries: input.response.queries,
    sources: input.response.sources.map((source) => ({
      title: source.title,
      url: source.url,
    })),
  }
  input.state.attempts.push(attempt)
  return attempt
}

export function recordResearchFailure(input: {
  readonly state: CreativeWorkerResearchState
  readonly request: ReturnType<typeof normalizeResearchRequest>
  readonly status: Exclude<CreativeWorkerResearchAttempt['status'], 'completed'>
}): CreativeWorkerResearchAttempt {
  const attempt: CreativeWorkerResearchAttempt = {
    ordinal: input.state.attempts.length + 1,
    query: input.request.query,
    status: input.status,
    providerQueries: [],
    sources: [],
  }
  input.state.attempts.push(attempt)
  return attempt
}

export function projectCreativeWorkerResearchEvidence(input: {
  readonly locale: Locale
  readonly state: CreativeWorkerResearchState
}): CreativeWorkerResearchEvidence {
  const completed = input.state.attempts.filter((attempt) => attempt.status === 'completed').length
  const status: CreativeWorkerResearchEvidence['status'] = input.state.attempts.length === 0
    ? 'not_attempted'
    : completed === input.state.attempts.length
      ? 'completed'
      : completed > 0
        ? 'partial'
        : input.state.attempts.some((attempt) => attempt.status === 'unavailable')
          ? 'unavailable'
          : input.state.attempts.some((attempt) => attempt.status === 'failed')
            ? 'failed'
            : 'budget_exhausted'
  return creativeWorkerResearchEvidenceSchema.parse({
    status,
    provider: input.state.provider,
    notice: localizedNotice(input.locale, status),
    budget: {
      maxCalls: input.state.maxCalls,
      usedCalls: input.state.usedCalls,
    },
    queries: input.state.attempts,
  })
}
