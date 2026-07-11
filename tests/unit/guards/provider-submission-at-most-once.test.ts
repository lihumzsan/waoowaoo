import { describe, expect, it } from 'vitest'
import { inspectProviderSubmissionSource } from '../../../scripts/guards/provider-submission-at-most-once-guard.mjs'

describe('provider submission at-most-once guard', () => {
  it('accepts a provider POST and task media call with explicit at-most-once contracts', () => {
    expect(inspectProviderSubmissionSource({
      file: 'src/lib/workers/example.ts',
      content: [
        "fetchWithRetry(url, { method: 'POST', policy: RETRY_POLICY.providerSubmit })",
        "generateImage(userId, model, prompt, options, { key: 'media:image:primary' })",
      ].join('\n'),
    })).toEqual([])
  })

  it('rejects retryable provider POST and task media calls without an invocation key', () => {
    expect(inspectProviderSubmissionSource({
      file: 'src/lib/workers/example.ts',
      content: [
        "fetchWithRetry(url, { method: 'POST', policy: RETRY_POLICY.mediaFetch })",
        'generateVideo(userId, model, imageUrl, options)',
      ].join('\n'),
    })).toEqual(expect.arrayContaining([
      expect.stringContaining('provider POST must use RETRY_POLICY.providerSubmit'),
      expect.stringContaining('must declare a stable provider invocation key'),
    ]))
  })
})
