import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveWorkspaceAssistantUserMessageId } from '@/features/project-workspace/components/workspace-assistant/workspace-assistant-command-receipt'

describe('workspace assistant command receipt', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('preserves the deterministic dispatch identity when HTTP omits SubtleCrypto', async () => {
    vi.stubGlobal('crypto', {
      getRandomValues<T extends ArrayBufferView | null>(array: T): T {
        return array
      },
    })

    await expect(resolveWorkspaceAssistantUserMessageId({
      scopeKey: 'project-1',
      sourceKey: 'source-1',
      immutableInput: null,
    })).resolves.toBe(
      'agent-dispatch:f00fef567f8b29d42df972caad2973c4cf3d9e0fb1ebab8a741907a3b00b795b',
    )
  })
})
