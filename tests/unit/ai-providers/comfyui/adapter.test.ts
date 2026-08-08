import { describe, expect, it } from 'vitest'
import { comfyuiAdapter } from '@/lib/ai-providers/comfyui/adapter'

describe('ComfyUI provider adapter', () => {
  it('owns video, music, and voice capabilities', () => {
    expect(comfyuiAdapter.providerKey).toBe('comfyui')
    expect(comfyuiAdapter.video).toBeDefined()
    expect(comfyuiAdapter.music).toBeDefined()
    expect(comfyuiAdapter.voice).toBeDefined()
  })
})
