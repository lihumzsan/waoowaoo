import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  executeTaskDurableInvocation,
  executeTaskProviderInvocation,
  listTaskAcceptedProviderExternalIds,
  markTaskProviderInvocationReplayAuthorized,
  markTaskProviderInvocationReplayAuthorizedByExternalId,
  readTaskProviderInvocationExternalId,
  readTaskProviderInvocationRouteSelection,
} from '@/lib/task/provider-invocation'
import { withLogContext } from '@/lib/logging/context'
import { TASK_TYPE } from '@/lib/task/types'
import { parseStoredAiLlmExecutionResult } from '@/lib/ai-exec/llm/result-projector'
import type { AiLlmExecutionResult } from '@/lib/ai-registry/types'
import { ProviderSubmissionError } from '@/lib/ai-exec/submission-error'
import { resetBillingState } from '../../helpers/db-reset'
import { createQueuedTask, createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { prisma } from '../../helpers/prisma'

async function seedTask(taskId: string) {
  const user = await createTestUser()
  const project = await createTestProject(user.id)
  await createQueuedTask({
    id: taskId,
    userId: user.id,
    projectId: project.id,
    type: TASK_TYPE.WORKSPACE_RESOURCE_AUDIO,
    targetType: 'WorkspaceResource',
    targetId: `${taskId}-resource`,
    payload: { prompt: 'durable provider invocation' },
  })
}

function invoke(
  taskId: string,
  execute: () => Promise<{
    success: boolean
    audioUrl?: string
    async?: boolean
    externalId?: string
  }>,
  taskAttempt = 1,
  invocationKey = 'media:music:primary',
) {
  return withLogContext(
    { taskId, taskAttempt },
    async () =>
      await executeTaskProviderInvocation({
        taskId,
        invocation: { key: invocationKey },
        modality: 'music',
        logicalCapabilityId: 'music:google::lyria-3-pro-preview',
        primaryModelKey: 'google::lyria-3-pro-preview',
        routes: [
          {
            provider: 'google',
            modelKey: 'google::lyria-3-pro-preview',
            request: { prompt: 'durable provider invocation' },
            execute,
          },
        ],
      }),
  )
}

describe('provider invocation at-most-once DB integration', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  it('persists and replays the provider result without another external call', async () => {
    await seedTask('provider-replay-task')
    const execute = vi.fn(async () => ({ success: true, audioUrl: 'https://provider/result.mp3' }))

    await expect(invoke('provider-replay-task', execute)).resolves.toMatchObject({ success: true })
    await expect(invoke('provider-replay-task', execute)).resolves.toMatchObject({ success: true })

    expect(execute).toHaveBeenCalledTimes(1)
    await expect(
      prisma.taskExecutionCheckpoint.findFirstOrThrow({
        where: { taskId: 'provider-replay-task' },
        select: { state: true },
      }),
    ).resolves.toEqual({ state: 'submitted' })
  })

  it('re-submits only the explicitly failed invocation on a higher Task attempt', async () => {
    await seedTask('provider-selective-retry-task')
    const firstCue = vi.fn(async () => ({ success: true, audioUrl: 'https://provider/cue-1.mp3' }))
    const secondCue = vi.fn(async () => ({
      success: true,
      audioUrl: 'https://provider/cue-2-invalid.mp3',
    }))

    await expect(
      invoke('provider-selective-retry-task', firstCue, 1, 'media:music:cue:1'),
    ).resolves.toMatchObject({ success: true })
    await expect(
      invoke('provider-selective-retry-task', secondCue, 1, 'media:music:cue:2'),
    ).resolves.toMatchObject({ success: true })
    await withLogContext({ taskId: 'provider-selective-retry-task', taskAttempt: 1 }, async () => {
      await markTaskProviderInvocationReplayAuthorized({
        taskId: 'provider-selective-retry-task',
        invocation: { key: 'media:music:cue:2' },
        error: new Error('generated cue failed validation'),
      })
    })

    const sameAttemptRetry = vi.fn(async () => ({ success: true, audioUrl: 'must-not-run' }))
    await expect(
      invoke('provider-selective-retry-task', sameAttemptRetry, 1, 'media:music:cue:2'),
    ).rejects.toMatchObject({
      code: 'PROVIDER_SUBMIT_FAILED',
    })

    const replayFirstCue = vi.fn(async () => ({ success: true, audioUrl: 'must-not-run' }))
    const regenerateSecondCue = vi.fn(async () => ({
      success: true,
      audioUrl: 'https://provider/cue-2-recovered.mp3',
    }))
    await expect(
      invoke('provider-selective-retry-task', replayFirstCue, 2, 'media:music:cue:1'),
    ).resolves.toMatchObject({
      audioUrl: 'https://provider/cue-1.mp3',
    })
    await expect(
      invoke('provider-selective-retry-task', regenerateSecondCue, 2, 'media:music:cue:2'),
    ).resolves.toMatchObject({
      audioUrl: 'https://provider/cue-2-recovered.mp3',
    })

    expect(firstCue).toHaveBeenCalledTimes(1)
    expect(secondCue).toHaveBeenCalledTimes(1)
    expect(sameAttemptRetry).not.toHaveBeenCalled()
    expect(replayFirstCue).not.toHaveBeenCalled()
    expect(regenerateSecondCue).toHaveBeenCalledTimes(1)
  })

  it('re-opens an accepted async invocation only after its external job reaches failed', async () => {
    await seedTask('provider-external-terminal-retry-task')
    const firstSubmission = vi.fn(async () => ({
      success: true,
      async: true,
      externalId: 'FAL:IMAGE:model:first-request',
    }))
    await expect(
      invoke('provider-external-terminal-retry-task', firstSubmission, 1),
    ).resolves.toMatchObject({
      externalId: 'FAL:IMAGE:model:first-request',
    })
    await withLogContext(
      { taskId: 'provider-external-terminal-retry-task', taskAttempt: 1 },
      async () => {
        await markTaskProviderInvocationReplayAuthorizedByExternalId({
          taskId: 'provider-external-terminal-retry-task',
          externalId: 'FAL:IMAGE:model:first-request',
          error: new Error('external job failed'),
        })
      },
    )

    const secondSubmission = vi.fn(async () => ({
      success: true,
      async: true,
      externalId: 'FAL:IMAGE:model:second-request',
    }))
    await expect(
      invoke('provider-external-terminal-retry-task', secondSubmission, 2),
    ).resolves.toMatchObject({
      externalId: 'FAL:IMAGE:model:second-request',
    })
    expect(firstSubmission).toHaveBeenCalledTimes(1)
    expect(secondSubmission).toHaveBeenCalledTimes(1)
  })

  it('keeps independently requested image candidates in one Task behind distinct durable fences', async () => {
    await seedTask('provider-candidate-task')
    const execute = vi.fn(async () => ({
      success: true,
      audioUrl: 'https://provider/candidate.mp3',
    }))
    const invokeCandidate = async (key: string) =>
      await withLogContext(
        {
          taskId: 'provider-candidate-task',
          taskAttempt: 1,
        },
        async () =>
          await executeTaskProviderInvocation({
            taskId: 'provider-candidate-task',
            invocation: { key },
            modality: 'image',
            logicalCapabilityId: 'image:fal::image-model',
            primaryModelKey: 'fal::image-model',
            routes: [
              {
                provider: 'fal',
                modelKey: 'fal::image-model',
                request: { prompt: 'same candidate prompt' },
                execute,
              },
            ],
          }),
      )

    await expect(invokeCandidate('media:image:candidate:0')).resolves.toMatchObject({
      success: true,
    })
    await expect(invokeCandidate('media:image:candidate:0')).resolves.toMatchObject({
      success: true,
    })
    await expect(invokeCandidate('media:image:candidate:1')).resolves.toMatchObject({
      success: true,
    })

    expect(execute).toHaveBeenCalledTimes(2)
    await expect(
      prisma.taskExecutionCheckpoint.count({
        where: { taskId: 'provider-candidate-task' },
      }),
    ).resolves.toBe(2)
  })

  it('advances one logical invocation to the next declared route only after typed pre-accept rejection', async () => {
    await seedTask('provider-route-failover-task')
    const primary = vi.fn(async () => {
      throw new ProviderSubmissionError(
        'PROVIDER_BILLING_REQUIRED',
        'primary account hard limit',
        {
          disposition: 'pre_accept_rejected',
          provider: 'openrouter',
          cause: { name: 'ProviderRejection', message: 'primary account hard limit' },
        },
      )
    })
    const secondary = vi.fn(async () => ({
      success: true,
      async: true,
      externalId: 'FAL:IMAGE:openai/gpt-image-2:secondary-request',
    }))

    const result = await withLogContext(
      { taskId: 'provider-route-failover-task', taskAttempt: 1 },
      async () =>
        await executeTaskProviderInvocation({
          taskId: 'provider-route-failover-task',
          invocation: { key: 'media:image:primary' },
          modality: 'image',
          logicalCapabilityId: 'image.gpt-image-2',
          primaryModelKey: 'openrouter::openai/gpt-image-2',
          routes: [
            {
              provider: 'openrouter',
              modelKey: 'openrouter::openai/gpt-image-2',
              request: { prompt: 'same prompt', aspectRatio: '1:1' },
              execute: primary,
            },
            {
              provider: 'fal',
              modelKey: 'fal::gpt-image-2',
              request: { prompt: 'same prompt', aspectRatio: '1:1' },
              execute: secondary,
            },
          ],
        }),
    )

    expect(primary).toHaveBeenCalledTimes(1)
    expect(secondary).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      success: true,
      externalId: 'FAL:IMAGE:openai/gpt-image-2:secondary-request',
      metadata: {
        providerRoute: {
          logicalCapabilityId: 'image.gpt-image-2',
          routeIndex: 1,
          provider: 'fal',
          modelKey: 'fal::gpt-image-2',
        },
      },
    })
    const checkpoint = await prisma.taskExecutionCheckpoint.findFirstOrThrow({
      where: { taskId: 'provider-route-failover-task' },
      select: { state: true, output: true },
    })
    expect(checkpoint.state).toBe('submitted')
    expect(checkpoint.output).toMatchObject({
      protocol: 'media_routes_v1',
      logicalCapabilityId: 'image.gpt-image-2',
      routeAttempts: [
        { routeIndex: 0, provider: 'openrouter', state: 'pre_accept_rejected' },
        {
          routeIndex: 1,
          provider: 'fal',
          state: 'submitted',
          externalId: 'FAL:IMAGE:openai/gpt-image-2:secondary-request',
        },
      ],
    })
    await expect(
      readTaskProviderInvocationRouteSelection({
        taskId: 'provider-route-failover-task',
        invocation: { key: 'media:image:primary' },
      }),
    ).resolves.toEqual({
      provider: 'fal',
      modelKey: 'fal::gpt-image-2',
      logicalCapabilityId: 'image.gpt-image-2',
    })
    await expect(
      readTaskProviderInvocationExternalId({
        taskId: 'provider-route-failover-task',
        invocation: { key: 'media:image:primary' },
      }),
    ).resolves.toBe('FAL:IMAGE:openai/gpt-image-2:secondary-request')
    await expect(
      listTaskAcceptedProviderExternalIds('provider-route-failover-task'),
    ).resolves.toEqual(['FAL:IMAGE:openai/gpt-image-2:secondary-request'])
  })

  it('does not advance a route set when the primary submission outcome is ambiguous', async () => {
    await seedTask('provider-route-ambiguous-task')
    const primary = vi.fn(async () => {
      throw new TypeError('connection closed after request write')
    })
    const secondary = vi.fn(async () => ({ success: true, audioUrl: 'must-not-run' }))

    await expect(
      withLogContext(
        { taskId: 'provider-route-ambiguous-task', taskAttempt: 1 },
        async () =>
          await executeTaskProviderInvocation({
            taskId: 'provider-route-ambiguous-task',
            invocation: { key: 'media:image:primary' },
            modality: 'image',
            logicalCapabilityId: 'image.gpt-image-2',
            primaryModelKey: 'openrouter::openai/gpt-image-2',
            routes: [
              {
                provider: 'openrouter',
                modelKey: 'openrouter::openai/gpt-image-2',
                request: { prompt: 'same prompt' },
                execute: primary,
              },
              {
                provider: 'fal',
                modelKey: 'fal::gpt-image-2',
                request: { prompt: 'same prompt' },
                execute: secondary,
              },
            ],
          }),
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_SUBMISSION_OUTCOME_UNKNOWN' })
    expect(primary).toHaveBeenCalledTimes(1)
    expect(secondary).not.toHaveBeenCalled()
    await expect(
      prisma.taskExecutionCheckpoint.findFirstOrThrow({
        where: { taskId: 'provider-route-ambiguous-task' },
        select: { state: true },
      }),
    ).resolves.toEqual({ state: 'outcome_unknown' })
    await expect(
      readTaskProviderInvocationRouteSelection({
        taskId: 'provider-route-ambiguous-task',
        invocation: { key: 'media:image:primary' },
      }),
    ).resolves.toBeNull()
  })

  it('serializes a concurrent first claim so only one caller can invoke the provider', async () => {
    await seedTask('provider-concurrent-task')
    let releaseProvider!: () => void
    const blocked = new Promise<void>((resolve) => {
      releaseProvider = resolve
    })
    const execute = vi.fn(async () => {
      await blocked
      return { success: true, audioUrl: 'https://provider/result.mp3' }
    })

    const owner = invoke('provider-concurrent-task', execute)
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    await expect(invoke('provider-concurrent-task', execute)).rejects.toMatchObject({
      code: 'PROVIDER_SUBMISSION_OUTCOME_UNKNOWN',
    })
    releaseProvider()
    await expect(owner).resolves.toMatchObject({ success: true })

    expect(execute).toHaveBeenCalledTimes(1)
    await expect(
      prisma.taskExecutionCheckpoint.count({
        where: { taskId: 'provider-concurrent-task' },
      }),
    ).resolves.toBe(1)
  })

  it('persists an unknown outcome and refuses every later resubmission', async () => {
    await seedTask('provider-unknown-task')
    const failedExecute = vi.fn(async () => {
      throw new TypeError('connection closed')
    })
    const replayExecute = vi.fn(async () => ({ success: true, audioUrl: 'must-not-run' }))

    await expect(invoke('provider-unknown-task', failedExecute)).rejects.toMatchObject({
      code: 'PROVIDER_SUBMISSION_OUTCOME_UNKNOWN',
    })
    await expect(invoke('provider-unknown-task', replayExecute)).rejects.toMatchObject({
      code: 'PROVIDER_SUBMISSION_OUTCOME_UNKNOWN',
    })

    expect(failedExecute).toHaveBeenCalledTimes(1)
    expect(replayExecute).not.toHaveBeenCalled()
    await expect(
      prisma.taskExecutionCheckpoint.findFirstOrThrow({
        where: { taskId: 'provider-unknown-task' },
        select: { state: true },
      }),
    ).resolves.toEqual({ state: 'outcome_unknown' })
  })

  it('does not infer safe resubmission from an AI SDK statusCode', async () => {
    await seedTask('provider-ai-sdk-status-retry-task')
    const firstAttempt = vi.fn(async () => {
      throw Object.assign(new Error('AI SDK request failed with rate limit'), { statusCode: 429 })
    })
    const mustNotRun = vi.fn(async () => ({
      success: true,
      audioUrl: 'https://provider/recovered-from-ai-sdk-status.mp3',
    }))

    await expect(
      invoke('provider-ai-sdk-status-retry-task', firstAttempt, 1),
    ).rejects.toMatchObject({
      code: 'PROVIDER_SUBMISSION_OUTCOME_UNKNOWN',
    })
    await expect(
      prisma.taskExecutionCheckpoint.findFirstOrThrow({
        where: { taskId: 'provider-ai-sdk-status-retry-task' },
        select: { state: true },
      }),
    ).resolves.toEqual({ state: 'outcome_unknown' })

    await expect(invoke('provider-ai-sdk-status-retry-task', mustNotRun, 2)).rejects.toMatchObject({
      code: 'PROVIDER_SUBMISSION_OUTCOME_UNKNOWN',
    })
    expect(firstAttempt).toHaveBeenCalledTimes(1)
    expect(mustNotRun).not.toHaveBeenCalled()
  })

  it('does not infer a provider disposition from HTTP 422 alone', async () => {
    await seedTask('provider-status-only-rejection-task')
    const rejectedExecute = vi.fn(async () => {
      throw Object.assign(new Error('request cannot be accepted'), { status: 422 })
    })
    const laterAttempt = vi.fn(async () => ({ success: true, audioUrl: 'must-not-run' }))

    await expect(
      invoke('provider-status-only-rejection-task', rejectedExecute, 1),
    ).rejects.toMatchObject({
      code: 'PROVIDER_SUBMISSION_OUTCOME_UNKNOWN',
      failure: { recovery: { operation: 'provider.submit', taskReplay: 'forbidden' } },
    })
    await expect(
      invoke('provider-status-only-rejection-task', laterAttempt, 2),
    ).rejects.toMatchObject({
      code: 'PROVIDER_SUBMISSION_OUTCOME_UNKNOWN',
      failure: { recovery: { operation: 'provider.submit', taskReplay: 'forbidden' } },
    })

    expect(rejectedExecute).toHaveBeenCalledTimes(1)
    expect(laterAttempt).not.toHaveBeenCalled()
    await expect(
      prisma.taskExecutionCheckpoint.findFirstOrThrow({
        where: { taskId: 'provider-status-only-rejection-task' },
        select: { state: true },
      }),
    ).resolves.toEqual({ state: 'outcome_unknown' })
  })

  it('persists and replays the full adapter-owned rejection fact', async () => {
    await seedTask('provider-typed-validation-task')
    const validationExecute = vi.fn(async () => {
      throw new ProviderSubmissionError(
        'PROVIDER_SUBMISSION_REJECTED',
        'ElevenLabs rejected the music Composition Plan',
        {
          disposition: 'rejected',
          provider: 'elevenlabs',
          details: { httpStatus: 422, providerCode: 'bad_composition_plan' },
          cause: {
            name: 'ElevenLabsValidationError',
            message: 'ElevenLabs rejected the music Composition Plan',
          },
        },
      )
    })
    const laterAttempt = vi.fn(async () => ({ success: true, audioUrl: 'must-not-run' }))

    await expect(
      invoke('provider-typed-validation-task', validationExecute, 1),
    ).rejects.toMatchObject({
      code: 'PROVIDER_SUBMISSION_REJECTED',
      details: { httpStatus: 422, providerCode: 'bad_composition_plan' },
      failure: { recovery: { operation: 'provider.submit', taskReplay: 'forbidden' } },
    })
    await expect(invoke('provider-typed-validation-task', laterAttempt, 2)).rejects.toMatchObject({
      code: 'PROVIDER_SUBMISSION_REJECTED',
      failure: { recovery: { operation: 'provider.submit', taskReplay: 'forbidden' } },
    })

    expect(validationExecute).toHaveBeenCalledTimes(1)
    expect(laterAttempt).not.toHaveBeenCalled()
    await expect(
      prisma.taskExecutionCheckpoint.findFirstOrThrow({
        where: { taskId: 'provider-typed-validation-task' },
        select: { state: true, output: true },
      }),
    ).resolves.toMatchObject({
      state: 'rejected',
      output: {
        failure: {
          version: 2,
          native: {
            name: 'ElevenLabsValidationError',
            message: 'ElevenLabs rejected the music Composition Plan',
          },
          interpretation: {
            code: 'PROVIDER_SUBMISSION_REJECTED',
            details: { httpStatus: 422, providerCode: 'bad_composition_plan' },
          },
          context: { system: 'provider', provider: 'elevenlabs', phase: 'submit' },
          recovery: { taskReplay: 'forbidden' },
        },
      },
    })
  })

  it('persists and replays an LLM completion before handler checkpoint settlement', async () => {
    await seedTask('llm-replay-task')
    const storedResult: AiLlmExecutionResult = {
      schemaVersion: 1 as const,
      provider: 'ark',
      modelId: 'analysis-model',
      text: 'completed answer',
      reasoning: 'completed reasoning',
      termination: { kind: 'normal' as const, rawReason: 'stop' },
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      response: { id: 'response-1' },
    }
    const execute = vi.fn(async (): Promise<AiLlmExecutionResult> => storedResult)
    const invokeLlm = async () =>
      await withLogContext(
        {
          taskId: 'llm-replay-task',
          taskAttempt: 1,
        },
        async () =>
          await executeTaskDurableInvocation({
            taskId: 'llm-replay-task',
            invocation: { key: 'ai:llm:generate:generate:1:1' },
            modality: 'llm',
            provider: 'llm-runtime',
            modelKey: 'provider::analysis-model',
            request: { messages: [{ role: 'user', content: 'immutable prompt' }] },
            execute,
            resultPolicy: {
              parse: parseStoredAiLlmExecutionResult,
            },
          }),
      )

    await expect(invokeLlm()).resolves.toMatchObject({
      schemaVersion: 1,
      response: { id: 'response-1' },
    })
    await expect(invokeLlm()).resolves.toMatchObject({
      schemaVersion: 1,
      response: { id: 'response-1' },
    })

    expect(execute).toHaveBeenCalledTimes(1)
    await expect(
      prisma.taskExecutionCheckpoint.findFirstOrThrow({
        where: { taskId: 'llm-replay-task' },
        select: { state: true },
      }),
    ).resolves.toEqual({ state: 'submitted' })
  })
})
