import { describe, expect, it } from 'vitest'
import { formatExternalId, parseExternalId } from '@/lib/ai-exec/async-poll'
import { normalizeAsyncPollResult } from '@/lib/ai-providers/async-task-types'

describe('async poll externalId contract', () => {
  it('requires an explicit disposition and typed code only for failed provider terminals', () => {
    expect(() => normalizeAsyncPollResult({ status: 'failed', error: 'terminal' }))
      .toThrow('ASYNC_PROVIDER_FAILURE_DISPOSITION_REQUIRED')
    expect(() => normalizeAsyncPollResult({ status: 'pending', failureDisposition: 'retryable' }))
      .toThrow('ASYNC_PROVIDER_NON_FAILURE_DISPOSITION_FORBIDDEN')
    expect(() => normalizeAsyncPollResult({ status: 'failed', failureDisposition: 'permanent', error: 'safety' }))
      .toThrow('ASYNC_PROVIDER_FAILURE_CODE_REQUIRED')
    expect(normalizeAsyncPollResult({
      status: 'failed',
      failureDisposition: 'permanent',
      errorCode: 'EXTERNAL_ERROR',
      error: 'safety',
    })).toMatchObject({
      status: 'failed',
      failureDisposition: 'permanent',
      errorCode: 'EXTERNAL_ERROR',
    })
  })

  it('parses standard FAL externalId with endpoint', () => {
    const parsed = parseExternalId('FAL:VIDEO:fal-ai/wan/v2.6/image-to-video:req_123')
    expect(parsed.provider).toBe('FAL')
    expect(parsed.type).toBe('VIDEO')
    expect(parsed.endpoint).toBe('fal-ai/wan/v2.6/image-to-video')
    expect(parsed.requestId).toBe('req_123')
  })

  it('rejects legacy non-standard externalId formats', () => {
    expect(() => parseExternalId('FAL:fal-ai/wan/v2.6/image-to-video:req_123')).toThrow(/无效 FAL externalId/)
    expect(() => parseExternalId('batches/legacy')).toThrow(/无法识别的 externalId 格式/)
  })

  it('requires endpoint when formatting FAL externalId', () => {
    expect(() => formatExternalId('FAL', 'VIDEO', 'req_123')).toThrow(/requires endpoint/)
  })

  it('parses and formats FAL music externalId through the shared async protocol', () => {
    const externalId = formatExternalId('FAL', 'MUSIC', 'music_123', 'fal-ai/lyria-3/8b')
    expect(externalId).toBe('FAL:MUSIC:fal-ai/lyria-3/8b:music_123')

    const parsed = parseExternalId(externalId)
    expect(parsed.provider).toBe('FAL')
    expect(parsed.type).toBe('MUSIC')
    expect(parsed.endpoint).toBe('fal-ai/lyria-3/8b')
    expect(parsed.requestId).toBe('music_123')
  })

  it('parses and formats ARK externalId', () => {
    const externalId = formatExternalId('ARK', 'VIDEO', 'task_123')
    expect(externalId).toBe('ARK:VIDEO:task_123')

    const parsed = parseExternalId(externalId)
    expect(parsed.provider).toBe('ARK')
    expect(parsed.type).toBe('VIDEO')
    expect(parsed.requestId).toBe('task_123')
  })

  it('parses and formats GOOGLE video externalId', () => {
    const externalId = formatExternalId('GOOGLE', 'VIDEO', 'task_456')
    expect(externalId).toBe('GOOGLE:VIDEO:task_456')

    const parsed = parseExternalId(externalId)
    expect(parsed.provider).toBe('GOOGLE')
    expect(parsed.type).toBe('VIDEO')
    expect(parsed.requestId).toBe('task_456')
  })

  it('parses and formats OPENROUTER video externalId', () => {
    const externalId = formatExternalId('OPENROUTER', 'VIDEO', 'job_789')
    expect(externalId).toBe('OPENROUTER:VIDEO:job_789')

    const parsed = parseExternalId(externalId)
    expect(parsed.provider).toBe('OPENROUTER')
    expect(parsed.type).toBe('VIDEO')
    expect(parsed.requestId).toBe('job_789')
  })

  it('parses and formats TOONFLOW video externalId', () => {
    const externalId = formatExternalId('TOONFLOW', 'VIDEO', 'cgt_task_789')
    expect(externalId).toBe('TOONFLOW:VIDEO:cgt_task_789')

    const parsed = parseExternalId(externalId)
    expect(parsed.provider).toBe('TOONFLOW')
    expect(parsed.type).toBe('VIDEO')
    expect(parsed.requestId).toBe('cgt_task_789')
  })
})
