import { describe, expect, it } from 'vitest'
import { codexAdapter } from '@/lib/ai-providers/codex/adapter'

describe('Codex provider adapter', () => {
  it('owns text and image capabilities', () => {
    expect(codexAdapter.providerKey).toBe('codex')
    expect(codexAdapter.languageModel).toBeDefined()
    expect(codexAdapter.image).toBeDefined()
  })
})
