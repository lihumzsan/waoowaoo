import { describe, expect, it } from 'vitest'
import type { E2eDiagnostics } from '../../../scripts/e2e-long-form/diagnostics-types'
import { createE2eWatchdogState, findE2eTerminalFailure, updateE2eWatchdogState } from '../../../scripts/e2e-long-form/watchdog'

function diagnostics(overrides: Partial<E2eDiagnostics> = {}): E2eDiagnostics {
  return {
    project: { id: 'project-1', userId: 'user-1', name: 'project', videoRatio: '16:9' },
    episode: { id: 'episode-1', name: 'episode', episodeNumber: 1 },
    workflow: {
      active: true,
      stage: 'assets_ready_for_review',
      blocking: { kind: 'needs_user_choice', reason: null },
      nextAction: null,
      allowedOperationIds: [],
    },
    sourceDocuments: [],
    bible: null,
    stylePreviews: [],
    chapters: [],
    finalOutput: null,
    musicScore: null,
    tasks: [],
    runs: [],
    waits: [],
    interruptions: [],
    event: { count: 1, latestId: '1' },
    ...overrides,
  }
}

describe('long-form E2E watchdog', () => {
  it('marks no-progress loops as stuck', () => {
    let state = createE2eWatchdogState(0)
    state = updateE2eWatchdogState({ state, diagnostics: diagnostics(), now: 10 })

    expect(findE2eTerminalFailure({
      diagnostics: diagnostics(),
      stageTimeoutMs: 100,
      overallTimeoutMs: 1000,
      state,
      now: 111,
    })).toEqual({
      status: 'SYSTEM_FAIL',
      code: 'E2E_STUCK',
      message: 'no workflow, task, wait, or interruption progress for 100ms at stage assets_ready_for_review',
    })
  })

  it('classifies provider-only task failures separately from system failures', () => {
    expect(findE2eTerminalFailure({
      diagnostics: diagnostics({
        tasks: [{
          id: 'task-1',
          type: 'edit_style_preview_image',
          targetType: 'ProjectEditStylePreview',
          targetId: 'style-1',
          status: 'failed',
          progress: 0,
          operationId: 'generate_edit_style_previews',
          batchKey: null,
          errorCode: 'TRANSIENT_PROVIDER',
          errorMessage: 'FAL upstream 500',
          updatedAt: '2026-07-08T00:00:00.000Z',
        }],
      }),
      stageTimeoutMs: 1000,
      overallTimeoutMs: 2000,
      state: createE2eWatchdogState(0),
      now: 1,
    })?.status).toBe('PROVIDER_FAIL')
  })
})
