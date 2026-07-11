import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  executeTaskDurableInvocation,
  executeTaskProviderInvocation,
} from '@/lib/task/provider-invocation'
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

function invoke(taskId: string, execute: () => Promise<{ success: boolean; audioUrl?: string }>) {
  return executeTaskProviderInvocation({
    taskId,
    invocation: { key: 'media:music:primary' },
    modality: 'music',
    provider: 'google',
    modelKey: 'google::lyria-3-pro-preview',
    request: { prompt: 'durable provider invocation' },
    execute,
  })
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

  it('persists and replays an LLM completion before handler checkpoint settlement', async () => {
    await seedTask('llm-replay-task')
    const execute = vi.fn(async () => ({ id: 'completion-1', choices: [{ index: 0 }] }))
    const invokeLlm = async () => await executeTaskDurableInvocation({
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
    })

    await expect(invokeLlm()).resolves.toMatchObject({ id: 'completion-1' })
    await expect(invokeLlm()).resolves.toMatchObject({ id: 'completion-1' })

    expect(execute).toHaveBeenCalledTimes(1)
    await expect(prisma.taskExecutionCheckpoint.findFirstOrThrow({
      where: { taskId: 'llm-replay-task' },
      select: { state: true },
    })).resolves.toEqual({ state: 'submitted' })
  })
})
