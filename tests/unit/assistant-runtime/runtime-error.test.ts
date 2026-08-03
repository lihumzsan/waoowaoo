import { describe, expect, it } from 'vitest'
import { normalizeAssistantRuntimeFailure } from '@/lib/assistant-runtime/runtime-error'
import { AssistantRuntimeEventProjector } from '@/lib/assistant-runtime/event-projector'

describe('Codex runtime terminal error projection', () => {
  it('classifies a stream disconnect as a retryable network failure fact', () => {
    expect(normalizeAssistantRuntimeFailure({
      message: 'stream disconnected before completion',
      codexErrorInfo: {
        responseStreamDisconnected: { httpStatusCode: null },
      },
      additionalDetails: null,
    })).toEqual({
      errorCode: 'NETWORK_ERROR',
      errorMessage: 'stream disconnected before completion',
    })
  })

  it('classifies a provider protocol rejection without parsing its message', () => {
    expect(normalizeAssistantRuntimeFailure({
      message: 'Provider returned error',
      codexErrorInfo: 'badRequest',
      additionalDetails: 'messages.2 rejected',
    })).toEqual({
      errorCode: 'ASSISTANT_PROVIDER_REQUEST_INVALID',
      errorMessage: 'Provider returned error',
    })
  })

  it('keeps retry notifications non-terminal and persists the final typed failure', async () => {
    const projector = new AssistantRuntimeEventProjector({
      identity: {
        projectId: 'project',
        userId: 'user',
        assistantId: 'workspace-command',
        threadId: 'product-thread',
        runtimeThreadId: 'runtime-thread',
        turnId: 'product-turn',
        runtimeTurnId: 'runtime-turn',
        attempt: 1,
        status: 'running',
      },
      sink: {
        reserveChunk: () => null,
        setMessageId: () => undefined,
        publishChunksThrough: async () => undefined,
        publishViewChanged: async () => undefined,
      },
      onInteraction: async () => undefined,
      onInteractionResolved: async () => undefined,
      onPlan: async () => undefined,
      onMessageSnapshot: async () => undefined,
      onSkillsList: async () => ({ cwd: '/workspace', skills: [], errors: [] }),
      modelKey: 'provider::model',
    })
    const error = {
      message: 'stream disconnected',
      codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: null } },
      additionalDetails: null,
    }
    projector.consume({
      type: 'notification',
      method: 'error',
      params: {
        threadId: 'runtime-thread',
        turnId: 'runtime-turn',
        willRetry: true,
        error,
      },
    })
    projector.consume({
      type: 'notification',
      method: 'turn/completed',
      params: {
        threadId: 'runtime-thread',
        turn: {
          id: 'runtime-turn',
          status: 'failed',
          error,
        },
      },
    })

    await expect(projector.terminal).resolves.toMatchObject({
      status: 'failed',
      stopReason: 'runtime_failed',
      errorCode: 'NETWORK_ERROR',
      errorMessage: 'stream disconnected',
    })
  })
})
