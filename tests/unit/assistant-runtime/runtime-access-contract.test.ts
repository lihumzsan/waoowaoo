import { describe, expect, it } from 'vitest'
import { ASSISTANT_RUNTIME_STATIC_CONTRACT } from '@/lib/assistant-runtime/runtime-access'

describe('assistant native runtime contract', () => {
  it('uses the supported v2 remote compaction protocol', () => {
    expect(ASSISTANT_RUNTIME_STATIC_CONTRACT.tools.features.remoteCompactionV2).toBe(true)
  })
})
