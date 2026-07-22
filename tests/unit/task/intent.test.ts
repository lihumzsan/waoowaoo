import { describe, expect, it } from 'vitest'
import { TASK_TYPE } from '@/lib/task/types'
import { resolveTaskIntent } from '@/lib/task/intent'

describe('resolveTaskIntent', () => {
  it('maps every CreativeResource generation task', () => {
    expect(resolveTaskIntent(TASK_TYPE.CREATIVE_RESOURCE_IMAGE)).toBe('generate')
    expect(resolveTaskIntent(TASK_TYPE.CREATIVE_RESOURCE_AUDIO)).toBe('generate')
    expect(resolveTaskIntent(TASK_TYPE.CREATIVE_RESOURCE_VOICE)).toBe('generate')
    expect(resolveTaskIntent(TASK_TYPE.CREATIVE_RESOURCE_VIDEO)).toBe('generate')
  })

  it('maps Creative Work and deterministic video merge by their actual intent', () => {
    expect(resolveTaskIntent(TASK_TYPE.CREATIVE_WORK)).toBe('analyze')
    expect(resolveTaskIntent(TASK_TYPE.CREATIVE_RESOURCE_VIDEO_MERGE)).toBe('process')
  })

  it('falls back to process for unknown types', () => {
    expect(resolveTaskIntent('unknown_type')).toBe('process')
    expect(resolveTaskIntent(null)).toBe('process')
    expect(resolveTaskIntent(undefined)).toBe('process')
  })
})
