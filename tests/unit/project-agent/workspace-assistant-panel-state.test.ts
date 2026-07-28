import { describe, expect, it } from 'vitest'
import {
  shouldShowWorkspaceAssistantReplyLoading,
} from '@/features/project-workspace/components/workspace-assistant/workspace-assistant-panel-state'
import {
  resolveWorkspaceAssistantComposerPending,
  resolveWorkspaceAssistantReplyInFlight,
} from '@/features/project-workspace/components/workspace-assistant/workspace-assistant-runtime-state'

describe('Workspace Assistant foreground and background presentation', () => {
  it('keeps the composer available for an awaiting background Task', () => {
    expect(resolveWorkspaceAssistantComposerPending({
      replyInFlight: false,
      trackedRunStatus: 'awaiting_task',
    })).toBe(false)
  })

  it('disables the composer while a foreground reply is actually running', () => {
    expect(resolveWorkspaceAssistantComposerPending({
      replyInFlight: true,
      trackedRunStatus: 'running',
    })).toBe(true)
  })

  it.each([
    ['chat transport', {
      requestActive: false,
      chatTransportActive: true,
      controlRunActive: false,
      serverRunActive: false,
    }],
    ['control stream', {
      requestActive: false,
      chatTransportActive: false,
      controlRunActive: true,
      serverRunActive: false,
    }],
    ['server continuation', {
      requestActive: false,
      chatTransportActive: false,
      controlRunActive: false,
      serverRunActive: true,
    }],
  ] as const)('uses the same panel-tail liveness for an active %s', (_label, sources) => {
    const replyInFlight = resolveWorkspaceAssistantReplyInFlight(sources)
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyInFlight,
      hasPendingInteraction: false,
    })).toBe(true)
  })

  it('stops foreground liveness when the durable Choice is current', () => {
    expect(shouldShowWorkspaceAssistantReplyLoading({
      storageLoading: false,
      replyInFlight: true,
      hasPendingInteraction: true,
    })).toBe(false)
  })
})
