import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FetchStatusError } from '@/lib/retry'

type CheckpointRow = {
  id: string
  taskId: string
  stepKey: string
  inputFingerprint: string
  state: string
  output: unknown
  completedAt: Date | null
}

const checkpointState = vi.hoisted(() => ({
  row: null as CheckpointRow | null,
  rows: new Map<string, CheckpointRow>(),
}))

const prismaMock = vi.hoisted(() => ({
  taskExecutionCheckpoint: {
    findUnique: vi.fn(async ({ where }: {
      where: { taskId_stepKey: { taskId: string; stepKey: string } }
    }) => checkpointState.rows.get(`${where.taskId_stepKey.taskId}:${where.taskId_stepKey.stepKey}`) ?? null),
    create: vi.fn(async ({ data }: { data: CheckpointRow }) => {
      const identity = `${data.taskId}:${data.stepKey}`
      if (checkpointState.rows.has(identity)) {
        throw new Prisma.PrismaClientKnownRequestError('unique conflict', {
          code: 'P2002',
          clientVersion: 'test',
        })
      }
      const row = { ...data, completedAt: null }
      checkpointState.rows.set(identity, row)
      checkpointState.row = row
      return row
    }),
    updateMany: vi.fn(async ({ where, data }: {
      where: { id: string; state: string }
      data: { state: string; output: unknown; completedAt: Date }
    }) => {
      const entry = [...checkpointState.rows.entries()].find(([, row]) => row.id === where.id)
      const row = entry?.[1]
      if (!entry || !row || row.state !== where.state) return { count: 0 }
      const updated = { ...row, ...data }
      checkpointState.rows.set(entry[0], updated)
      checkpointState.row = updated
      return { count: 1 }
    }),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/execution-checkpoint', () => ({
  loadTaskExecutionFingerprint: vi.fn(async () => 'f'.repeat(64)),
}))

import {
  executeTaskDurableInvocation,
  executeTaskProviderInvocation,
} from '@/lib/task/provider-invocation'

function executeWith(execute: () => Promise<{ success: boolean; imageUrl?: string; error?: string }>) {
  return executeTaskProviderInvocation({
    taskId: 'task-1',
    invocation: { key: 'media:image:primary' },
    modality: 'image',
    provider: 'fal',
    modelKey: 'fal::image-model',
    request: { prompt: 'same immutable request' },
    execute,
  })
}

describe('task provider invocation at-most-once fence', () => {
  beforeEach(() => {
    checkpointState.row = null
    checkpointState.rows.clear()
    vi.clearAllMocks()
  })

  it('replays a submitted provider result without executing the provider again', async () => {
    const execute = vi.fn(async () => ({ success: true, imageUrl: 'https://provider/result.png' }))

    await expect(executeWith(execute)).resolves.toEqual({
      success: true,
      imageUrl: 'https://provider/result.png',
    })
    await expect(executeWith(execute)).resolves.toEqual({
      success: true,
      imageUrl: 'https://provider/result.png',
    })

    expect(execute).toHaveBeenCalledTimes(1)
    expect(checkpointState.row?.state).toBe('submitted')
  })

  it('keeps distinct candidate identities independent while replaying each candidate once', async () => {
    const execute = vi.fn(async () => ({ success: true, imageUrl: 'https://provider/result.png' }))
    const invokeCandidate = async (key: string) => await executeTaskProviderInvocation({
      taskId: 'task-1',
      invocation: { key },
      modality: 'image',
      provider: 'fal',
      modelKey: 'fal::image-model',
      request: { prompt: 'same immutable request' },
      execute,
    })

    await expect(invokeCandidate('media:image:candidate:0')).resolves.toMatchObject({ success: true })
    await expect(invokeCandidate('media:image:candidate:0')).resolves.toMatchObject({ success: true })
    await expect(invokeCandidate('media:image:candidate:1')).resolves.toMatchObject({ success: true })

    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('marks a lost provider response as outcome unknown and never resubmits it', async () => {
    const firstExecute = vi.fn(async () => {
      throw new TypeError('connection closed before response')
    })
    const replayExecute = vi.fn(async () => ({ success: true, imageUrl: 'must-not-run' }))

    await expect(executeWith(firstExecute)).rejects.toMatchObject({
      code: 'PROVIDER_SUBMISSION_OUTCOME_UNKNOWN',
      retryable: false,
    })
    await expect(executeWith(replayExecute)).rejects.toMatchObject({
      code: 'PROVIDER_SUBMISSION_OUTCOME_UNKNOWN',
      retryable: false,
    })

    expect(firstExecute).toHaveBeenCalledTimes(1)
    expect(replayExecute).not.toHaveBeenCalled()
    expect(checkpointState.row?.state).toBe('outcome_unknown')
  })

  it('allows only the invocation fence creator to execute during a concurrent first claim', async () => {
    let releaseProvider!: () => void
    const providerBlocked = new Promise<void>((resolve) => {
      releaseProvider = resolve
    })
    const execute = vi.fn(async () => {
      await providerBlocked
      return { success: true, imageUrl: 'https://provider/result.png' }
    })

    const owner = executeWith(execute)
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    await expect(executeWith(execute)).rejects.toMatchObject({
      code: 'PROVIDER_SUBMISSION_OUTCOME_UNKNOWN',
      retryable: false,
    })
    releaseProvider()
    await expect(owner).resolves.toMatchObject({ success: true })

    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('persists an explicit provider rejection and does not retry it', async () => {
    const execute = vi.fn(async () => ({ success: false, error: 'request rejected' }))

    await expect(executeWith(execute)).rejects.toMatchObject({
      code: 'PROVIDER_SUBMISSION_REJECTED',
      retryable: false,
    })
    await expect(executeWith(execute)).rejects.toMatchObject({
      code: 'PROVIDER_SUBMISSION_REJECTED',
      retryable: false,
    })

    expect(execute).toHaveBeenCalledTimes(1)
    expect(checkpointState.row?.state).toBe('rejected')
  })

  it('treats an HTTP error response as a known rejection', async () => {
    const execute = vi.fn(async () => {
      throw new FetchStatusError(400, 'invalid request')
    })

    await expect(executeWith(execute)).rejects.toMatchObject({
      code: 'PROVIDER_SUBMISSION_REJECTED',
      retryable: false,
    })
    expect(checkpointState.row?.state).toBe('rejected')
  })

  it('replays a durable LLM result without invoking the model twice', async () => {
    const execute = vi.fn(async () => ({ id: 'completion-1', choices: [{ index: 0 }] }))
    const invoke = async () => await executeTaskDurableInvocation({
      taskId: 'task-1',
      invocation: { key: 'ai:llm:step:step:1:1' },
      modality: 'llm',
      provider: 'llm-runtime',
      modelKey: 'provider::model',
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

    await expect(invoke()).resolves.toEqual({ id: 'completion-1', choices: [{ index: 0 }] })
    await expect(invoke()).resolves.toEqual({ id: 'completion-1', choices: [{ index: 0 }] })

    expect(execute).toHaveBeenCalledTimes(1)
    expect(checkpointState.row?.state).toBe('submitted')
  })

  it('persists and replays a falsy durable result without invoking twice', async () => {
    const execute = vi.fn(async () => false)
    const invoke = async () => await executeTaskDurableInvocation({
      taskId: 'task-1',
      invocation: { key: 'provider:boolean-result' },
      modality: 'test',
      provider: 'test-provider',
      modelKey: 'test::boolean',
      request: { value: false },
      execute,
      resultPolicy: {
        parse: (value) => {
          if (typeof value !== 'boolean') throw new Error('BOOLEAN_RESULT_INVALID')
          return value
        },
      },
    })

    await expect(invoke()).resolves.toBe(false)
    await expect(invoke()).resolves.toBe(false)

    expect(execute).toHaveBeenCalledTimes(1)
    expect(checkpointState.row?.state).toBe('submitted')
  })
})
