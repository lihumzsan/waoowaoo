import { describe, expect, it } from 'vitest'
import { formatExternalId, parseExternalId } from '@/lib/ai-exec/async-poll'

describe('async poll externalId contract', () => {
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
})
