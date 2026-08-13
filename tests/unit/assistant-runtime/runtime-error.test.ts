import { describe, expect, it } from 'vitest'
import { normalizeAssistantRuntimeFailure } from '@/lib/assistant-runtime/runtime-error'
import {
  AssistantRuntimeEventProjector,
  projectAssistantRuntimeToolOutput,
} from '@/lib/assistant-runtime/event-projector'
import type { UnifiedErrorCode } from '@/lib/errors/codes'

function expectedRuntimeFailure(code: UnifiedErrorCode, message: string) {
  return {
    version: 2,
    native: { message },
    interpretation: { code, details: null },
    context: {
      system: 'runtime',
      provider: 'codex',
      phase: 'turn',
    },
    recovery: {
      operation: null,
      effect: 'unknown',
      taskReplay: 'forbidden',
      attempts: 1,
    },
    frames: [],
  }
}

describe('Codex runtime terminal error projection', () => {
  it('projects canonical MCP structured output instead of the transport envelope', () => {
    expect(projectAssistantRuntimeToolOutput({
      id: 'tool-call',
      type: 'mcpToolCall',
      status: 'completed',
      result: {
        structuredContent: {
          ok: true,
          data: {
            success: true,
            async: true,
            taskId: 'task-1',
          },
        },
        content: [{ type: 'text', text: 'transport copy' }],
      },
    })).toEqual({
      ok: true,
      data: {
        success: true,
        async: true,
        taskId: 'task-1',
      },
    })

    expect(projectAssistantRuntimeToolOutput({
      id: 'failed-tool-call',
      type: 'mcpToolCall',
      status: 'completed',
      result: {
        structuredContent: {
          ok: false,
          error: { code: 'INVALID_PARAMS', message: 'Correct the input.' },
        },
      },
    })).toEqual({
      ok: false,
      error: { code: 'INVALID_PARAMS', message: 'Correct the input.' },
    })

    expect(projectAssistantRuntimeToolOutput({
      id: 'interrupted-tool-call',
      type: 'mcpToolCall',
      status: 'interrupted',
      result: {
        structuredContent: {
          ok: true,
          data: { success: true },
        },
      },
    })).toEqual({
      status: 'interrupted',
      error: null,
    })
  })

  it('classifies a stream disconnect as a retryable network failure fact', () => {
    expect(normalizeAssistantRuntimeFailure({
      message: 'stream disconnected before completion',
      codexErrorInfo: {
        responseStreamDisconnected: { httpStatusCode: null },
      },
      additionalDetails: null,
    })).toMatchObject(expectedRuntimeFailure(
      'NETWORK_ERROR',
      'stream disconnected before completion',
    ))
  })

  it('classifies a provider protocol rejection without parsing its message', () => {
    expect(normalizeAssistantRuntimeFailure({
      message: 'Provider returned error',
      codexErrorInfo: 'badRequest',
      additionalDetails: 'messages.2 rejected',
    })).toMatchObject(expectedRuntimeFailure(
      'ASSISTANT_PROVIDER_REQUEST_INVALID',
      'Provider returned error',
    ))
  })

  it('classifies the pinned provider billing fact without parsing its message', () => {
    expect(normalizeAssistantRuntimeFailure({
      message: 'provider-specific billing copy',
      codexErrorInfo: 'usageLimitExceeded',
      additionalDetails: null,
    }, { providerCredentialMode: 'user-key' })).toMatchObject(expectedRuntimeFailure(
      'PROVIDER_BILLING_REQUIRED',
      'provider-specific billing copy',
    ))
  })

  it('attributes provider billing to the platform when the platform owns the key', () => {
    expect(normalizeAssistantRuntimeFailure({
      message: 'provider-specific billing copy',
      codexErrorInfo: 'usageLimitExceeded',
      additionalDetails: null,
    }, { providerCredentialMode: 'platform-key' })).toMatchObject(expectedRuntimeFailure(
      'PLATFORM_PROVIDER_BILLING_REQUIRED',
      'provider-specific billing copy',
    ))
  })

  it('attributes a normalized Provider outage to the platform key owner', () => {
    expect(normalizeAssistantRuntimeFailure({
      message: 'slow_down',
      codexErrorInfo: 'serverOverloaded',
      additionalDetails: null,
    }, { providerCredentialMode: 'platform-key' })).toMatchObject(expectedRuntimeFailure(
      'PLATFORM_PROVIDER_UNAVAILABLE',
      'slow_down',
    ))
  })

  it('normalizes an upstream HTTP status carried by a structured Codex error', () => {
    expect(normalizeAssistantRuntimeFailure({
      message: 'upstream request failed',
      codexErrorInfo: {
        responseTooManyFailedAttempts: { httpStatusCode: 402 },
      },
      additionalDetails: null,
    }, { providerCredentialMode: 'platform-key' })).toMatchObject(expectedRuntimeFailure(
      'PLATFORM_PROVIDER_BILLING_REQUIRED',
      'upstream request failed',
    ))
  })

  it('normalizes provider authentication from the structured upstream status', () => {
    expect(normalizeAssistantRuntimeFailure({
      message: 'provider request rejected',
      codexErrorInfo: {
        httpConnectionFailed: { httpStatusCode: 401 },
      },
      additionalDetails: null,
    }, { providerCredentialMode: 'platform-key' })).toMatchObject(expectedRuntimeFailure(
      'PLATFORM_PROVIDER_AUTH_INVALID',
      'provider request rejected',
    ))
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
        sealChunksThrough: () => undefined,
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
      failure: expectedRuntimeFailure('NETWORK_ERROR', 'stream disconnected'),
    })
  })
})
