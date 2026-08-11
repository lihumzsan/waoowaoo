import { createHash, randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { resolveAiProviderAdapter } from '@/lib/ai-providers'
import { ProviderHttpError } from '@/lib/ai-providers/failure'
import {
  ASSISTANT_RUNTIME_ASSISTANT_ID,
  type AssistantRuntimeTurnIdentity,
} from '@/lib/assistant-runtime/contracts'
import {
  settleAssistantRuntimeTurn,
} from '@/lib/assistant-runtime/persistence'
import { getAssistantRuntimeSessionView } from '@/lib/assistant-runtime/session-view'
import {
  createFailureRecord,
  parseFailureRecord,
} from '@/lib/errors/failure'
import {
  claimCodexProviderAttempt,
  failCodexProviderAttempt,
  succeedCodexProviderAttempt,
} from '@/lib/codex-model-gateway/provider-attempt'
import { observeCodexProviderSuccessResponse } from '@/lib/codex-model-gateway/provider-response-observer'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { resetBillingState } from '../../helpers/db-reset'
import { prisma } from '../../helpers/prisma'

async function seedRunningTurn(): Promise<{
  readonly identity: AssistantRuntimeTurnIdentity
  readonly projectId: string
  readonly userId: string
}> {
  const user = await createTestUser()
  const project = await createTestProject(user.id)
  const thread = await prisma.projectAssistantThread.create({
    data: {
      projectId: project.id,
      userId: user.id,
      assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID,
      runtimeThreadId: null,
      messagesJson: [],
    },
  })
  const runtimeTurnId = `runtime_turn_${randomUUID()}`
  const turn = await prisma.projectAgentTurn.create({
    data: {
      id: `product_turn_${randomUUID()}`,
      threadId: thread.id,
      projectId: project.id,
      userId: user.id,
      sourceKind: 'user',
      sourceId: `source_${randomUUID()}`,
      payloadHash: 'a'.repeat(64),
      requestId: randomUUID(),
      status: 'running',
      attempt: 1,
      executionOwnerId: runtimeTurnId,
      contextJson: {
        locale: 'zh',
        selectedScopeRef: null,
        selectedAssetId: null,
      },
      runtimeTurnId,
      startedAt: new Date(),
    },
  })
  return {
    projectId: project.id,
    userId: user.id,
    identity: {
      projectId: project.id,
      userId: user.id,
      assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID,
      threadId: thread.id,
      runtimeThreadId: null,
      turnId: turn.id,
      runtimeTurnId,
      attempt: 1,
      status: 'running',
    },
  }
}

function requestHash(label: string): string {
  return createHash('sha256').update(label).digest('hex')
}

function openRouterFailure(input: {
  readonly message: string
  readonly code: string
  readonly status: number
  readonly requestId: string
}) {
  return resolveAiProviderAdapter('openrouter').failure.normalize({
    phase: 'submit',
    error: new ProviderHttpError({
      provider: 'openrouter',
      phase: 'submit',
      statusCode: input.status,
      requestId: input.requestId,
      code: input.code,
      diagnosticText: input.message,
      errorEnvelope: {
        error: { code: input.code, message: input.message },
      },
    }),
  })
}

describe('Assistant Provider source failure persistence', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  it('keeps every retry attempt and links the final failed source into the sole Turn terminal writer', async () => {
    const seeded = await seedRunningTurn()
    const first = await claimCodexProviderAttempt({
      projectId: seeded.projectId,
      userId: seeded.userId,
      turnId: seeded.identity.turnId,
      runtimeAttempt: seeded.identity.attempt,
      providerKey: 'openrouter',
      modelKey: 'openrouter:test',
      requestHash: requestHash('first'),
    })
    const firstFailure = openRouterFailure({
      message: 'first provider attempt failed',
      code: 'provider_overloaded',
      status: 503,
      requestId: 'provider-request-first',
    })
    await failCodexProviderAttempt(first, {
      failure: firstFailure,
      providerStatus: 503,
      providerRequestId: 'provider-request-first',
    })

    const finalAttempt = await claimCodexProviderAttempt({
      projectId: seeded.projectId,
      userId: seeded.userId,
      turnId: seeded.identity.turnId,
      runtimeAttempt: seeded.identity.attempt,
      providerKey: 'openrouter',
      modelKey: 'openrouter:test',
      requestHash: requestHash('final'),
    })
    const finalFailure = openRouterFailure({
      message: 'final provider diagnostic',
      code: 'future_provider_rejection',
      status: 422,
      requestId: 'provider-request-final',
    })
    await failCodexProviderAttempt(finalAttempt, {
      failure: finalFailure,
      providerStatus: 422,
      providerRequestId: 'provider-request-final',
    })

    const runtimeFailure = createFailureRecord(
      'PROJECT_AGENT_RUNTIME_FAILED',
      'second-hand Codex failure',
      {
        cause: { name: 'CodexTurnError', message: 'second-hand Codex failure' },
        context: { system: 'runtime', provider: 'codex', phase: 'turn' },
      },
    )
    const projection = {
      status: 'failed' as const,
      stopReason: 'runtime_failed',
      failure: runtimeFailure,
      assistantMessage: null,
      usage: null,
    }
    await settleAssistantRuntimeTurn({ identity: seeded.identity, projection })
    await expect(settleAssistantRuntimeTurn({
      identity: seeded.identity,
      projection,
    })).resolves.toBeUndefined()

    const attempts = await prisma.projectAgentProviderAttempt.findMany({
      where: { turnId: seeded.identity.turnId },
      orderBy: { sequence: 'asc' },
    })
    expect(attempts).toHaveLength(2)
    expect(attempts.map((attempt) => attempt.status)).toEqual(['failed', 'failed'])
    expect(parseFailureRecord(attempts[0]?.failure)?.native.message).toBe('first provider attempt failed')
    expect(parseFailureRecord(attempts[1]?.failure)?.native.message).toBe('final provider diagnostic')

    const storedTurn = await prisma.projectAgentTurn.findUniqueOrThrow({
      where: { id: seeded.identity.turnId },
    })
    const storedFailure = parseFailureRecord(storedTurn.failure)
    expect(storedFailure?.native).toMatchObject({
      message: 'final provider diagnostic',
      code: 'future_provider_rejection',
      statusCode: 422,
      requestId: 'provider-request-final',
    })
    expect(storedFailure?.interpretation.details).toMatchObject({
      providerAttemptId: finalAttempt.id,
      providerAttemptSequence: finalAttempt.sequence.toString(),
    })

    const view = await getAssistantRuntimeSessionView({
      projectId: seeded.projectId,
      userId: seeded.userId,
      assistantId: ASSISTANT_RUNTIME_ASSISTANT_ID,
    })
    expect(view.currentTurn).toMatchObject({
      status: 'failed',
      errorDiagnostic: 'final provider diagnostic',
    })

    await expect(succeedCodexProviderAttempt(finalAttempt, {
      providerStatus: 200,
    })).rejects.toThrow('CODEX_PROVIDER_ATTEMPT_TERMINAL_DIVERGED')
  })

  it('does not replace a later successful Provider attempt with an older failure', async () => {
    const seeded = await seedRunningTurn()
    const failedAttempt = await claimCodexProviderAttempt({
      projectId: seeded.projectId,
      userId: seeded.userId,
      turnId: seeded.identity.turnId,
      runtimeAttempt: 1,
      providerKey: 'openrouter',
      modelKey: 'openrouter:test',
      requestHash: requestHash('failed'),
    })
    await failCodexProviderAttempt(failedAttempt, {
      failure: openRouterFailure({
        message: 'older provider failure',
        code: 'provider_overloaded',
        status: 503,
        requestId: 'provider-request-old',
      }),
      providerStatus: 503,
    })
    const succeededAttempt = await claimCodexProviderAttempt({
      projectId: seeded.projectId,
      userId: seeded.userId,
      turnId: seeded.identity.turnId,
      runtimeAttempt: 1,
      providerKey: 'openrouter',
      modelKey: 'openrouter:test',
      requestHash: requestHash('succeeded'),
    })
    await succeedCodexProviderAttempt(succeededAttempt, {
      providerStatus: 200,
      providerGenerationId: 'generation-success',
    })

    const runtimeFailure = createFailureRecord('INTERNAL_ERROR', 'runtime persistence failed', {
      cause: { name: 'RuntimePersistenceError', message: 'runtime persistence failed' },
      context: { system: 'runtime', phase: 'persistence' },
    })
    await settleAssistantRuntimeTurn({
      identity: seeded.identity,
      projection: {
        status: 'failed',
        stopReason: 'runtime_persistence_failed',
        failure: runtimeFailure,
        assistantMessage: null,
        usage: null,
      },
    })

    const stored = await prisma.projectAgentTurn.findUniqueOrThrow({
      where: { id: seeded.identity.turnId },
    })
    expect(parseFailureRecord(stored.failure)).toEqual(runtimeFailure)
  })

  it('persists a streaming source failure before releasing the terminal frame to Codex', async () => {
    const seeded = await seedRunningTurn()
    const attempt = await claimCodexProviderAttempt({
      projectId: seeded.projectId,
      userId: seeded.userId,
      turnId: seeded.identity.turnId,
      runtimeAttempt: 1,
      providerKey: 'openrouter',
      modelKey: 'openrouter:test',
      requestHash: requestHash('stream-failed'),
    })
    const terminalPayload = {
      type: 'response.failed',
      response: {
        id: 'generation-stream-failed',
        status: 'failed',
        error: {
          code: 'future_stream_failure',
          message: 'native stream terminal diagnostic',
        },
      },
    }
    const terminalFrame = `data: ${JSON.stringify(terminalPayload)}\n\n`
    const splitAt = terminalFrame.indexOf('response.failed') + 'response.'.length
    const firstChunk = terminalFrame.slice(0, splitAt)
    const secondChunk = terminalFrame.slice(splitAt)
    const chunks = [firstChunk, secondChunk]
    const observed = await observeCodexProviderSuccessResponse({
      response: new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          const chunk = chunks.shift()
          if (chunk === undefined) {
            controller.close()
            return
          }
          controller.enqueue(new TextEncoder().encode(chunk))
        },
      }), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
      attempt,
      requestSignal: new AbortController().signal,
      providerRequestId: 'provider-stream-request',
      headerGenerationId: null,
    })
    if (!observed.body) throw new Error('OBSERVED_PROVIDER_STREAM_BODY_MISSING')
    const reader = observed.body.getReader()
    const firstFrame = await reader.read()
    expect(new TextDecoder().decode(firstFrame?.value)).toBe(firstChunk)
    while (!(await reader.read()).done) {
      // The observer must see the terminal frame before the persisted attempt
      // is asserted below; the first partial chunk must still be forwarded.
    }

    const stored = await prisma.projectAgentProviderAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    })
    expect(stored.status).toBe('failed')
    expect(parseFailureRecord(stored.failure)?.native.message).toBe('native stream terminal diagnostic')
    expect(stored.providerGenerationId).toBe('generation-stream-failed')
  })
})
