import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  resolveWorkspaceAssistantDisplayedPendingInteraction,
} from '@/features/project-workspace/components/workspace-assistant/workspace-assistant-runtime-state'
import type { ProjectAgentSessionPendingInteraction } from '@/lib/project-agent/session-state'

function buildPendingApproval(
  overrides: Partial<Extract<ProjectAgentSessionPendingInteraction, { kind: 'approval' }>> = {},
): ProjectAgentSessionPendingInteraction {
  return {
    kind: 'approval',
    runId: 'run-1',
    interruptionId: 'interruption-1',
    approvalId: 'approval-1',
    operationId: 'generate_edit_script_assets',
    toolCallId: null,
    ...overrides,
  }
}

describe('workspace assistant approval card dismissal', () => {
  it('keeps an unanswered pending approval visible', () => {
    const interaction = buildPendingApproval()

    expect(resolveWorkspaceAssistantDisplayedPendingInteraction({
      pendingInteraction: interaction,
      respondedInterruptionIds: new Set<string>(),
    })).toBe(interaction)
  })

  it('dismisses the card on the user response even while session-state polling still reports it pending', () => {
    expect(resolveWorkspaceAssistantDisplayedPendingInteraction({
      pendingInteraction: buildPendingApproval(),
      respondedInterruptionIds: new Set(['interruption-1']),
    })).toBeNull()
  })

  it('shows the card again after a failed control request removes the responded mark', () => {
    const interaction = buildPendingApproval()

    expect(resolveWorkspaceAssistantDisplayedPendingInteraction({
      pendingInteraction: interaction,
      respondedInterruptionIds: new Set<string>(),
    })).toBe(interaction)
  })

  it('never suppresses a different interruption raised after the answered one', () => {
    const nextInteraction = buildPendingApproval({
      interruptionId: 'interruption-2',
      approvalId: 'approval-2',
    })

    expect(resolveWorkspaceAssistantDisplayedPendingInteraction({
      pendingInteraction: nextInteraction,
      respondedInterruptionIds: new Set(['interruption-1']),
    })).toBe(nextInteraction)
  })

  it('resolves nothing when the server reports no pending interaction', () => {
    expect(resolveWorkspaceAssistantDisplayedPendingInteraction({
      pendingInteraction: null,
      respondedInterruptionIds: new Set(['interruption-1']),
    })).toBeNull()
  })

  it('marks before dispatch, restores only on request failure, and clears local pending before refresh', () => {
    const runtimeSource = readFileSync(
      join(process.cwd(), 'src/features/project-workspace/components/workspace-assistant/useWorkspaceAssistantRuntime.ts'),
      'utf8',
    )

    const markIndex = runtimeSource.indexOf('if (respondedInterruptionId) markInterruptionResponded(respondedInterruptionId)')
    const fetchIndex = runtimeSource.indexOf('const response = await fetch(')
    const catchUnmarkIndex = runtimeSource.indexOf('if (respondedInterruptionId) unmarkInterruptionResponded(respondedInterruptionId)')
    const localPendingClearIndex = runtimeSource.lastIndexOf('setActiveControlRun((current) => current?.runId === params.runId ? null : current)')
    const refreshIndex = runtimeSource.indexOf(
      'await refreshSessionState().catch(() => undefined)',
      localPendingClearIndex,
    )

    // The card must be suppressed in the same render as the click, before the
    // network round trip. Only a failed request withdraws it; after success the
    // mark survives a stale/failed refresh so an already-consumed card cannot
    // reopen. Local request state is cleared before refresh, so a failed or
    // hanging synchronization request cannot leave the UI permanently busy.
    expect(markIndex).toBeGreaterThan(-1)
    expect(fetchIndex).toBeGreaterThan(markIndex)
    expect(catchUnmarkIndex).toBeGreaterThan(fetchIndex)
    expect(runtimeSource.lastIndexOf('if (respondedInterruptionId) unmarkInterruptionResponded(respondedInterruptionId)')).toBe(catchUnmarkIndex)
    expect(localPendingClearIndex).toBeGreaterThan(catchUnmarkIndex)
    expect(refreshIndex).toBeGreaterThan(localPendingClearIndex)

    // Displayed pending interaction is derived through the single resolver.
    expect(runtimeSource).toContain('resolveWorkspaceAssistantDisplayedPendingInteraction({')

    // A failed control request must surface explicitly instead of vanishing.
    expect(runtimeSource).toContain('setControlError(buildWorkspaceAssistantControlError(params.endpoint, error))')
    expect(runtimeSource).toContain('error: chat.error ?? controlError ?? undefined')
  })
})
