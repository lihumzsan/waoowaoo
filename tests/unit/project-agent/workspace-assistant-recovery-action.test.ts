import { describe, expect, it } from 'vitest'
import { resolveWorkspaceAssistantRecoveryAction } from '@/features/project-workspace/components/workspace-assistant/workspace-assistant-panel-state'

describe('workspace assistant recovery action', () => {
  it('uses the canonical new-conversation action for a context budget failure', () => {
    expect(resolveWorkspaceAssistantRecoveryAction({
      turnStatus: 'failed',
      turnStartedAt: '2026-09-02T23:15:41.181Z',
      cancelReason: null,
      failureAction: 'new_conversation',
      canResend: false,
    })).toBe('new_conversation')
  })

  it('keeps the canonical new-conversation action for interrupted start failures', () => {
    expect(resolveWorkspaceAssistantRecoveryAction({
      turnStatus: 'interrupted',
      turnStartedAt: '2026-09-02T23:15:41.181Z',
      cancelReason: 'runtime_start_failed',
      failureAction: 'new_conversation',
      canResend: false,
    })).toBe('new_conversation')

    expect(resolveWorkspaceAssistantRecoveryAction({
      turnStatus: 'interrupted',
      turnStartedAt: null,
      cancelReason: 'runtime_start_failed',
      failureAction: 'new_conversation',
      canResend: true,
    })).toBe('new_conversation')
  })

  it('continues only failures whose canonical action is retry', () => {
    expect(resolveWorkspaceAssistantRecoveryAction({
      turnStatus: 'failed',
      turnStartedAt: '2026-09-02T23:15:41.181Z',
      cancelReason: null,
      failureAction: 'retry',
      canResend: false,
    })).toBe('continue')

    expect(resolveWorkspaceAssistantRecoveryAction({
      turnStatus: 'failed',
      turnStartedAt: '2026-09-02T23:15:41.181Z',
      cancelReason: null,
      failureAction: 'revise_input',
      canResend: false,
    })).toBeNull()

    expect(resolveWorkspaceAssistantRecoveryAction({
      turnStatus: 'failed',
      turnStartedAt: null,
      cancelReason: null,
      failureAction: 'revise_input',
      canResend: true,
    })).toBeNull()
  })

  it('keeps interrupted and undelivered recovery paths distinct', () => {
    expect(resolveWorkspaceAssistantRecoveryAction({
      turnStatus: 'interrupted',
      turnStartedAt: '2026-09-02T23:15:41.181Z',
      cancelReason: 'runtime_stopped',
      failureAction: null,
      canResend: false,
    })).toBe('continue')

    expect(resolveWorkspaceAssistantRecoveryAction({
      turnStatus: 'failed',
      turnStartedAt: null,
      cancelReason: null,
      failureAction: 'retry',
      canResend: true,
    })).toBe('resend')
  })
})
