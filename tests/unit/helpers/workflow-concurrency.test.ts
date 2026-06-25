import { describe, expect, it } from 'vitest'
import {
  DEFAULT_IMAGE_WORKFLOW_CONCURRENCY,
  DEFAULT_VIDEO_WORKFLOW_CONCURRENCY,
  normalizeWorkflowConcurrencyConfig,
} from '@/lib/workflow-concurrency'

describe('workflow concurrency defaults', () => {
  it('defaults image workflow concurrency to twenty', () => {
    expect(DEFAULT_IMAGE_WORKFLOW_CONCURRENCY).toBe(20)
    expect(normalizeWorkflowConcurrencyConfig(null).image).toBe(20)
    expect(normalizeWorkflowConcurrencyConfig({ image: undefined }).image).toBe(20)
  })

  it('defaults video workflow concurrency to ten', () => {
    expect(DEFAULT_VIDEO_WORKFLOW_CONCURRENCY).toBe(10)
    expect(normalizeWorkflowConcurrencyConfig(null).video).toBe(10)
    expect(normalizeWorkflowConcurrencyConfig({ video: undefined }).video).toBe(10)
  })

  it('uses explicit fallback defaults when normalizing missing values', () => {
    expect(normalizeWorkflowConcurrencyConfig(
      { image: undefined },
      { analysis: 6, image: 21, video: 12 },
    )).toEqual({ analysis: 6, image: 21, video: 12 })
  })
})
