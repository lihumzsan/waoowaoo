import { describe, expect, it } from 'vitest'
import {
  buildWorkspaceAssistantChatId,
  createWorkspaceAssistantControlMessageId,
  createWorkspaceAssistantControlVisibleUserMessage,
  findLatestWorkspaceAssistantRun,
  isWorkspaceAssistantOperationPendingStatus,
  isWorkspaceAssistantRunBusyStatus,
  mergeWorkspaceAssistantStreamedMessage,
  resolveWorkspaceAssistantPendingOperationId,
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
    expect(isWorkspaceAssistantRunBusyStatus('awaiting_task')).toBe(false)
    expect(shouldClearWorkspaceAssistantControlPending('awaiting_task')).toBe(false)

    for (const status of [
      'awaiting_approval',
      'awaiting_choice',
      'completed',
      'failed',
      'cancelled',
    ] as const) {
      expect(isWorkspaceAssistantRunBusyStatus(status)).toBe(false)
      expect(shouldClearWorkspaceAssistantControlPending(status)).toBe(true)
    }
  })

  it('uses running and awaiting-task runs as operation pending signals', () => {
    expect(isWorkspaceAssistantOperationPendingStatus('running')).toBe(true)
    expect(isWorkspaceAssistantOperationPendingStatus('awaiting_task')).toBe(true)
    expect(isWorkspaceAssistantOperationPendingStatus('awaiting_choice')).toBe(false)
    expect(isWorkspaceAssistantOperationPendingStatus('awaiting_approval')).toBe(false)
    expect(isWorkspaceAssistantOperationPendingStatus('completed')).toBe(false)
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
      intent: null,
    })
  })

  it('does not infer the active operation from historical dynamic tool parts', () => {
    const run = findLatestWorkspaceAssistantRun([
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [
          {
            type: 'data-agent-run',
            data: {
              runId: 'run-1',
              requestId: 'request-1',
              status: 'running',
              controlKind: 'user_turn',
            },
          } as never,
          {
            type: 'dynamic-tool',
            toolName: 'generate_edit_style_previews',
            state: 'input-available',
          } as never,
        ],
      },
    ])

    expect(run).toEqual({
      runId: 'run-1',
      status: 'running',
      operationId: null,
      intent: null,
    })
  })

  it('does not infer the active operation from historical operation-start data', () => {
    const run = findLatestWorkspaceAssistantRun([
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [
          {
            type: 'data-agent-run',
            data: {
              runId: 'run-1',
              requestId: 'request-1',
              status: 'running',
              controlKind: 'choice_response',
            },
          } as never,
          {
            type: 'data-agent-operation-start',
            data: {
              runId: 'run-1',
              operationId: 'generate_edit_style_previews',
              toolCallId: 'tool-generate-style',
            },
          } as never,
        ],
      },
    ])

    expect(run).toEqual({
      runId: 'run-1',
      status: 'running',
      operationId: null,
      intent: null,
    })
  })

  it('does not treat streamed read tools as active generation operations', () => {
    const run = findLatestWorkspaceAssistantRun([
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [
          {
            type: 'data-agent-run',
            data: {
              runId: 'run-1',
              requestId: 'request-1',
              status: 'running',
              controlKind: 'user_turn',
            },
          } as never,
          {
            type: 'dynamic-tool',
            toolName: 'get_project_phase',
            state: 'input-available',
          } as never,
        ],
      },
    ])

    expect(run).toEqual({
      runId: 'run-1',
      status: 'running',
      operationId: null,
      intent: null,
    })
  })

  it('does not restore current operation from persisted interruption history', () => {
    const run = findLatestWorkspaceAssistantRun([
      {
        id: 'assistant-approval',
        role: 'assistant',
        parts: [{
          type: 'data-agent-interruption',
          data: {
            runId: 'run-1',
            requestId: 'request-1',
            interruptionId: 'interruption-1',
            approvalId: 'approval-1',
            operationId: 'generate_edit_script',
          },
        } as never],
      },
      {
        id: 'assistant-control',
        role: 'assistant',
        parts: [{
          type: 'data-agent-run',
          data: {
            runId: 'run-1',
            requestId: 'request-2',
            status: 'running',
            controlKind: 'approval_response',
          },
        } as never],
      },
    ])

    expect(run).toEqual({
      runId: 'run-1',
      status: 'running',
      operationId: null,
      intent: null,
    })
  })

  it('never reports a pending operation while a denial is being delivered', () => {
    expect(resolveWorkspaceAssistantPendingOperationId({
      operationId: 'generate_edit_script',
      intent: 'deny',
      status: 'running',
    })).toBeNull()
    expect(resolveWorkspaceAssistantPendingOperationId({
      operationId: 'generate_edit_script',
      intent: 'approve',
      status: 'running',
    })).toBe('generate_edit_script')
    expect(resolveWorkspaceAssistantPendingOperationId({
      operationId: 'generate_edit_style_previews',
      intent: null,
      status: 'awaiting_task',
    })).toBe('generate_edit_style_previews')
    expect(resolveWorkspaceAssistantPendingOperationId({
      operationId: 'generate_edit_style_previews',
      intent: null,
      status: 'awaiting_choice',
    })).toBeNull()
    expect(resolveWorkspaceAssistantPendingOperationId(null)).toBeNull()
  })

  it('creates a stable non-empty assistant message id for run-scoped control streams', () => {
    expect(createWorkspaceAssistantControlMessageId({
      runId: ' run-1 ',
      endpoint: 'choice',
      nonce: 'nonce-1',
    })).toBe('workspace-control:choice:run-1:nonce-1')
  })

  it('creates visible user messages for free-text choice card feedback', () => {
    expect(createWorkspaceAssistantControlVisibleUserMessage({
      runId: ' run-1 ',
      endpoint: 'choice',
      text: '  把祠堂场景调得更旧  ',
      nonce: 'nonce-1',
    })).toEqual({
      id: 'workspace-control-user:choice:run-1:nonce-1',
      role: 'user',
      parts: [{ type: 'text', text: '把祠堂场景调得更旧' }],
    })
  })

  it('rejects control stream messages with empty ids before they can freeze persistence', () => {
    expect(() => mergeWorkspaceAssistantStreamedMessage([], {
      id: '',
      role: 'assistant',
      parts: [{ type: 'text', text: 'hello' }],
    })).toThrow('PROJECT_ASSISTANT_STREAM_MESSAGE_ID_EMPTY')
  })

  it('merges streamed control updates by their concrete message id', () => {
    const current = mergeWorkspaceAssistantStreamedMessage([], {
      id: 'workspace-control:choice:run-1:nonce-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'first chunk' }],
    })
    const next = mergeWorkspaceAssistantStreamedMessage(current, {
      id: 'workspace-control:choice:run-1:nonce-1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'final chunk' }],
    })

    expect(next).toEqual([
      {
        id: 'workspace-control:choice:run-1:nonce-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'final chunk' }],
      },
    ])
  })

})
