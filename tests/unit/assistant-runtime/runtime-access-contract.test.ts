import { describe, expect, it } from 'vitest'
import { ASSISTANT_RUNTIME_STATIC_CONTRACT } from '@/lib/assistant-runtime/runtime-access'

describe('assistant native runtime contract', () => {
  it('declares the native-authenticated local compaction provider', () => {
    expect(ASSISTANT_RUNTIME_STATIC_CONTRACT.tools.modelProvider).toEqual({
      id: 'wao-openai-local-compaction',
      name: 'Wao OpenAI',
      requiresOpenAiAuth: true,
      supportsWebsockets: true,
      supportsStandaloneWebSearch: true,
    })
  })
})
