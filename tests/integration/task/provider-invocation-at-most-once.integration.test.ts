import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  executeTaskDurableInvocation,
  executeTaskProviderInvocation,
} from '@/lib/task/provider-invocation'
import { withLogContext } from '@/lib/logging/context'
import { FetchStatusError } from '@/lib/retry'
import { TASK_TYPE } from '@/lib/task/types'
import { resetBillingState } from '../../helpers/db-reset'
import {
  createQueuedTask,
  createTestProject,
  createTestUser,
} from '../../helpers/billing-fixtures'
import { prisma } from '../../helpers/prisma'

async function seedTask(taskId: string) {
  const user = await createTestUser()
  const project = await createTestProject(user.id)
  await createQueuedTask({
    id: taskId,
    userId: user.id,
    projectId: project.id,
    type: TASK_TYPE.MUSIC_GENERATE,
    targetType: 'Project',
    targetId: project.id,
    payload: { prompt: 'durable provider invocation' },
  })
}

function invoke(
  taskId: string,
  execute: () => Promise<{ success: boolean; audioUrl?: string }>,
  taskAttempt = 1,
) {
  return withLogContext({ taskId, taskAttempt }, async () => await executeTaskProviderInvocation({
    taskId,
    invocation: { key: 'media:music:primary' },
    modality: 'music',
    provider: 'google',
    modelKey: 'google::lyria-3-pro-preview',
    request: { prompt: 'durable provider invocation' },
    execute,
  }))
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
    await expect(prisma.taskExecutionCheckpoint.findFirstOrThrow({
      where: { taskId: 'provider-replay-task' },
      select: { state: true },
    })).resolves.toEqual({ state: 'submitted' })
  })

  it('keeps independently requested image candidates in one Task behind distinct durable fences', async () => {
    await seedTask('provider-candidate-task')
    const execute = vi.fn(async () => ({ success: true, audioUrl: 'https://provider/candidate.mp3' }))
    const invokeCandidate = async (key: string) => await withLogContext({
      taskId: 'provider-candidate-task',
      taskAttempt: 1,
    }, async () => await executeTaskProviderInvocation({
      taskId: 'provider-candidate-task',
      invocation: { key },
      modality: 'image',
      provider: 'fal',
      modelKey: 'fal::image-model',
      request: { prompt: 'same candidate prompt' },
      execute,
    }))

    await expect(invokeCandidate('media:image:candidate:0')).resolves.toMatchObject({ success: true })
    await expect(invokeCandidate('media:image:candidate:0')).resolves.toMatchObject({ success: true })
    await expect(invokeCandidate('media:image:candidate:1')).resolves.toMatchObject({ success: true })

    expect(execute).toHaveBeenCalledTimes(2)
    await expect(prisma.taskExecutionCheckpoint.count({
      where: { taskId: 'provider-candidate-task' },
    })).resolves.toBe(2)
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
    await expect(prisma.taskExecutionCheckpoint.count({
      where: { taskId: 'provider-concurrent-task' },
    })).resolves.toBe(1)
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
    await expect(prisma.taskExecutionCheckpoint.findFirstOrThrow({
      where: { taskId: 'provider-unknown-task' },
      select: { state: true },
    })).resolves.toEqual({ state: 'outcome_unknown' })
  })

  it('lets only a newer Task attempt reclaim an explicit transient provider non-acceptance', async () => {
    await seedTask('provider-transient-retry-task')
    const firstAttempt = vi.fn(async () => {
      throw new FetchStatusError(503, 'provider temporarily unavailable')
    })
    const sameAttemptReplay = vi.fn(async () => ({ success: true, audioUrl: 'must-not-run' }))
    let releaseSecondAttempt!: () => void
    const secondAttemptBlocked = new Promise<void>((resolve) => {
      releaseSecondAttempt = resolve
    })
    const secondAttempt = vi.fn(async () => {
      await secondAttemptBlocked
      return { success: true, audioUrl: 'https://provider/recovered.mp3' }
    })

    await expect(invoke('provider-transient-retry-task', firstAttempt, 1)).rejects.toMatchObject({
      code: 'PROVIDER_SUBMIT_FAILED',
      retryable: true,
    })
    await expect(prisma.taskExecutionCheckpoint.findFirstOrThrow({
      where: { taskId: 'provider-transient-retry-task' },
      select: { state: true },
    })).resolves.toEqual({ state: 'retryable_rejected' })

    await expect(invoke('provider-transient-retry-task', sameAttemptReplay, 1)).rejects.toMatchObject({
      code: 'PROVIDER_SUBMIT_FAILED',
      retryable: true,
    })
    const recoveryOwner = invoke('provider-transient-retry-task', secondAttempt, 2)
    await vi.waitFor(() => expect(secondAttempt).toHaveBeenCalledTimes(1))
    await expect(invoke('provider-transient-retry-task', secondAttempt, 2)).rejects.toMatchObject({
      code: 'PROVIDER_SUBMISSION_OUTCOME_UNKNOWN',
    })
    releaseSecondAttempt()
    await expect(recoveryOwner).resolves.toMatchObject({
      success: true,
      audioUrl: 'https://provider/recovered.mp3',
    })
    await expect(invoke('provider-transient-retry-task', secondAttempt, 2)).resolves.toMatchObject({
      success: true,
    })

    expect(firstAttempt).toHaveBeenCalledTimes(1)
    expect(sameAttemptReplay).not.toHaveBeenCalled()
    expect(secondAttempt).toHaveBeenCalledTimes(1)
    await expect(prisma.taskExecutionCheckpoint.findFirstOrThrow({
      where: { taskId: 'provider-transient-retry-task' },
      select: { state: true },
    })).resolves.toEqual({ state: 'submitted' })
  })

  it('keeps an explicit permanent provider rejection closed across newer Task attempts', async () => {
    await seedTask('provider-permanent-rejection-task')
    const rejectedExecute = vi.fn(async () => {
      throw new FetchStatusError(422, 'request cannot be accepted')
    })
    const laterAttempt = vi.fn(async () => ({ success: true, audioUrl: 'must-not-run' }))

    await expect(invoke('provider-permanent-rejection-task', rejectedExecute, 1)).rejects.toMatchObject({
      code: 'PROVIDER_SUBMISSION_REJECTED',
      retryable: false,
    })
    await expect(invoke('provider-permanent-rejection-task', laterAttempt, 2)).rejects.toMatchObject({
      code: 'PROVIDER_SUBMISSION_REJECTED',
      retryable: false,
    })

    expect(rejectedExecute).toHaveBeenCalledTimes(1)
    expect(laterAttempt).not.toHaveBeenCalled()
    await expect(prisma.taskExecutionCheckpoint.findFirstOrThrow({
      where: { taskId: 'provider-permanent-rejection-task' },
      select: { state: true },
    })).resolves.toEqual({ state: 'rejected' })
  })

  it('persists and replays an LLM completion before handler checkpoint settlement', async () => {
    await seedTask('llm-replay-task')
    const execute = vi.fn(async () => ({ id: 'completion-1', choices: [{ index: 0 }] }))
    const invokeLlm = async () => await withLogContext({
      taskId: 'llm-replay-task',
      taskAttempt: 1,
    }, async () => await executeTaskDurableInvocation({
      taskId: 'llm-replay-task',
      invocation: { key: 'ai:llm:generate:generate:1:1' },
      modality: 'llm',
      provider: 'llm-runtime',
      modelKey: 'provider::analysis-model',
      request: { messages: [{ role: 'user', content: 'immutable prompt' }] },
      execute,
      resultPolicy: {
        parse: (value) => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('LLM_RESULT_INVALID')
          }
          return value as { id: string; choices: Array<{ index: number }> }
        },
      },
    }))

    await expect(invokeLlm()).resolves.toMatchObject({ id: 'completion-1' })
    await expect(invokeLlm()).resolves.toMatchObject({ id: 'completion-1' })

    expect(execute).toHaveBeenCalledTimes(1)
    await expect(prisma.taskExecutionCheckpoint.findFirstOrThrow({
      where: { taskId: 'llm-replay-task' },
      select: { state: true },
    })).resolves.toEqual({ state: 'submitted' })
  })
})
