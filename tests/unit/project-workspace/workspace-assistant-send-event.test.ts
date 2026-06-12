import { describe, expect, it } from 'vitest'
import {
  releaseWorkspaceAssistantMessageKey,
  reserveWorkspaceAssistantMessageKey,
} from '@/features/project-workspace/components/workspace-assistant/assistant-send-event'

describe('workspace assistant send event dedupe', () => {
  it('reserves a message key across component instances', () => {
    const firstLocalKeys = new Set<string>()
    const secondLocalKeys = new Set<string>()
    const key = `test:${crypto.randomUUID()}`

    expect(reserveWorkspaceAssistantMessageKey(key, firstLocalKeys)).toBe(key)
    expect(reserveWorkspaceAssistantMessageKey(key, firstLocalKeys)).toBeNull()
    expect(reserveWorkspaceAssistantMessageKey(key, secondLocalKeys)).toBeNull()

    releaseWorkspaceAssistantMessageKey(key, firstLocalKeys)
    expect(reserveWorkspaceAssistantMessageKey(key, secondLocalKeys)).toBe(key)
    releaseWorkspaceAssistantMessageKey(key, secondLocalKeys)
  })

  it('ignores blank keys', () => {
    expect(reserveWorkspaceAssistantMessageKey('   ', new Set<string>())).toBeNull()
  })
})
