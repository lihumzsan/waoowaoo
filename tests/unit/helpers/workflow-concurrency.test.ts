import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VIDEO_WORKFLOW_CONCURRENCY,
  normalizeWorkflowConcurrencyConfig,
} from '@/lib/workflow-concurrency'

describe('workflow concurrency defaults', () => {
  it('defaults video workflow concurrency to ten', () => {
    expect(DEFAULT_VIDEO_WORKFLOW_CONCURRENCY).toBe(10)
    expect(normalizeWorkflowConcurrencyConfig(null).video).toBe(10)
    expect(normalizeWorkflowConcurrencyConfig({ video: undefined }).video).toBe(10)
  })
})
