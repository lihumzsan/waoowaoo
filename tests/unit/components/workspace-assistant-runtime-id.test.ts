import { describe, expect, it } from 'vitest'
import {
  buildWorkspaceAssistantChatId,
  findLatestWorkspaceAssistantRun,
  isWorkspaceAssistantRunBusyStatus,
  resolveWorkspaceAssistantChoicePendingOperationId,
  shouldClearWorkspaceAssistantControlPending,
  shouldSendWorkspaceAssistantAutomatically,
} from '@/features/project-workspace/components/workspace-assistant/useWorkspaceAssistantRuntime'

describe('workspace assistant runtime chat id', () => {
  it('scopes chat sessions by project and episode only', () => {
    const episodeId = buildWorkspaceAssistantChatId({
      projectId: 'project-1',
      episodeId: 'episode-1',
    })
    const globalId = buildWorkspaceAssistantChatId({
      projectId: 'project-1',
    })

    expect(episodeId).toBe('workspace-command:project-1:episode-1')
    expect(globalId).toBe('workspace-command:project-1:global')
    expect(episodeId).not.toBe(globalId)
  })

  it('keeps AI SDK automatic tool-loop sending disabled for the Agents SDK runtime', () => {
    expect(shouldSendWorkspaceAssistantAutomatically()).toBe(false)
  })

  it('uses server run status as the global assistant busy signal', () => {
    expect(isWorkspaceAssistantRunBusyStatus('running')).toBe(true)
    expect(shouldClearWorkspaceAssistantControlPending('running')).toBe(false)

    for (const status of [
      'awaiting_approval',
      'awaiting_choice',
      'awaiting_task',
      'completed',
      'failed',
      'cancelled',
    ] as const) {
      expect(isWorkspaceAssistantRunBusyStatus(status)).toBe(false)
      expect(shouldClearWorkspaceAssistantControlPending(status)).toBe(true)
    }
  })

  it('finds the latest streamed project agent run marker', () => {
    const run = findLatestWorkspaceAssistantRun([
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{
          type: 'data-agent-run',
          data: {
            runId: 'run-old',
            requestId: 'request-old',
            status: 'running',
            controlKind: 'user_turn',
          },
        } as never],
      },
      {
        id: 'assistant-2',
        role: 'assistant',
        parts: [{
          type: 'data-agent-run',
          data: {
            runId: 'run-new',
            requestId: 'request-new',
            status: 'running',
            controlKind: 'approval_response',
          },
        } as never],
      },
    ])

    expect(run).toEqual({
      runId: 'run-new',
      status: 'running',
      operationId: null,
    })
  })

  it('derives a display operation for run-scoped choice continuations', () => {
    expect(resolveWorkspaceAssistantChoicePendingOperationId({
      choiceType: 'duration_and_aspect_ratio',
      output: { ok: true, durationSeconds: 30, aspectRatio: '16:9' },
    })).toBe('generate_edit_screenplay')
    expect(resolveWorkspaceAssistantChoicePendingOperationId({
      choiceType: 'screenplay_review',
      output: { ok: true, decision: 'approve' },
    })).toBe('generate_edit_style_previews')
    expect(resolveWorkspaceAssistantChoicePendingOperationId({
      choiceType: 'screenplay_review',
      output: { ok: true, decision: 'revise', revisionNotes: '更惊悚' },
    })).toBe('revise_edit_screenplay')
    expect(resolveWorkspaceAssistantChoicePendingOperationId({
      choiceType: 'style',
      output: { ok: true, stylePreviewId: 'style-1', aspectRatio: '16:9' },
    })).toBe('generate_edit_director_decoupage')
  })
})
