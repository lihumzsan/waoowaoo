import { describe, expect, it } from 'vitest'
import {
  inspectProviderSubmissionSource,
  inspectTaskLlmInvocationIdentity,
} from '../../../scripts/guards/provider-submission-at-most-once-guard.mjs'

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

  it('rejects an LLM provider identity that changes with stream presentation attempts', () => {
    expect(inspectTaskLlmInvocationIdentity([
      'function taskAiInvocationKey(input) {',
      '  const stepAttempt = input.meta.stepAttempt ?? 1',
      '  return `ai:${input.meta.stepIndex}:${stepAttempt}`',
      '}',
    ].join('\n'))).toEqual(expect.arrayContaining([
      expect.stringContaining('must not include transient stepAttempt'),
    ]))
    expect(inspectTaskLlmInvocationIdentity([
      'function taskAiInvocationKey(input) {',
      '  return `ai:${input.meta.stepIndex}`',
      '}',
    ].join('\n'))).toEqual([])
  })
})
