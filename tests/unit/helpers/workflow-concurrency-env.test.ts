import { describe, expect, it } from 'vitest'
import { getDefaultWorkflowConcurrencyConfig } from '@/lib/workflow-concurrency-env'

describe('workflow concurrency env defaults', () => {
  it('reads per-user workflow concurrency defaults from env', () => {
    expect(getDefaultWorkflowConcurrencyConfig({
      DEFAULT_WORKFLOW_CONCURRENCY_ANALYSIS: '6',
      DEFAULT_WORKFLOW_CONCURRENCY_IMAGE: '20',
      DEFAULT_WORKFLOW_CONCURRENCY_VIDEO: '12',
    })).toEqual({
      analysis: 6,
      image: 20,
      video: 12,
    })
  })

  it('fails explicitly for invalid env values', () => {
    expect(() => getDefaultWorkflowConcurrencyConfig({
      DEFAULT_WORKFLOW_CONCURRENCY_IMAGE: 'warn',
    })).toThrow('DEFAULT_WORKFLOW_CONCURRENCY_IMAGE_INVALID')
  })
})
