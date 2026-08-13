import { describe, expect, it } from 'vitest'
import { codexAdapter } from '@/lib/ai-providers/codex/adapter'

describe('Codex provider adapter', () => {
  it('exposes image generation without a second text sampling owner', () => {
    expect(codexAdapter.providerKey).toBe('codex')
    expect(codexAdapter.image).toBeDefined()
  })
})
