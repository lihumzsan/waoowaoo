import { beforeEach, describe, expect, it, vi } from 'vitest'

type Processor = (job: { id: string; data: { outboxId: string } }) => Promise<void>

const bullmqMock = vi.hoisted(() => ({
  processor: null as Processor | null,
}))

const repositoryMock = vi.hoisted(() => ({
  claimOutboxCommand: vi.fn(async () => ({
    id: 'outbox-1',
    kind: 'project_agent.continue_wait',
    version: 1,
    payload: {
      kind: 'project_agent.continue_wait',
      version: 1,
      waitId: 'wait-1',
      runId: 'run-1',
      expectedRunVersion: 1,
      expectedEventSeq: '1',
    },
    deliveryCount: 1,
  })),
  acceptOutboxCommand: vi.fn(async () => true),
  extendOutboxCommandLease: vi.fn(async () => true),
  releaseOutboxCommand: vi.fn(async () => undefined),
}))

const followUpMock = vi.hoisted(() => ({
  runProjectAgentWaitContinuationCommand: vi.fn(async () => {
    throw new Error('CONTINUATION_DELIVERY_FAILED')
  }),
  settleProjectAgentWaitContinuationDeliveryExhausted: vi.fn(async () => 'settled' as const),
}))

vi.mock('bullmq', () => ({
  UnrecoverableError: class UnrecoverableError extends Error {},
  Worker: class Worker {
    constructor(_name: string, processor: Processor) {
      bullmqMock.processor = processor
    }
  },
}))
vi.mock('@/lib/outbox/repository', () => repositoryMock)
vi.mock('@/lib/project-agent/server-follow-up', () => followUpMock)
vi.mock('@/lib/redis', () => ({ queueRedis: {} }))
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}))
vi.mock('@/lib/task/publisher', () => ({ publishPersistedTaskEventById: vi.fn() }))
vi.mock('@/lib/task/enqueue', () => ({ enqueuePersistedTask: vi.fn() }))
vi.mock('@/lib/project-agent/session-event', () => ({
  publishPersistedProjectAgentSessionChangedById: vi.fn(),
}))
vi.mock('@/lib/workers/runtime-config', () => ({
  getOutboxRuntimeConfig: vi.fn(() => ({
    leaseMs: 60_000,
    maxDeliveryAttempts: 1,
  })),
  getWorkerConcurrency: vi.fn(() => 1),
}))

import { createOutboxWorker } from '@/lib/workers/outbox.worker'

function getProcessor(): Processor {
  createOutboxWorker()
  if (!bullmqMock.processor) throw new Error('OUTBOX_TEST_PROCESSOR_MISSING')
  return bullmqMock.processor
}

describe('Assistant continuation Outbox dead-letter handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    bullmqMock.processor = null
  })

  it('settles the Assistant continuation before marking its final Outbox delivery dead', async () => {
    const processor = getProcessor()

    await expect(processor({ id: 'outbox-1', data: { outboxId: 'outbox-1' } }))
      .rejects.toThrow('CONTINUATION_DELIVERY_FAILED')

    expect(followUpMock.settleProjectAgentWaitContinuationDeliveryExhausted).toHaveBeenCalledWith(
      expect.objectContaining({ waitId: 'wait-1', runId: 'run-1' }),
      'outbox-1',
    )
    expect(repositoryMock.releaseOutboxCommand).toHaveBeenCalledWith(expect.objectContaining({
      id: 'outbox-1',
      dead: true,
      error: 'CONTINUATION_DELIVERY_FAILED',
    }))
    expect(followUpMock.settleProjectAgentWaitContinuationDeliveryExhausted.mock.invocationCallOrder[0])
      .toBeLessThan(repositoryMock.releaseOutboxCommand.mock.invocationCallOrder[0] ?? 0)
  })

  it('keeps the Outbox retryable when the Assistant terminal settlement fails', async () => {
    followUpMock.settleProjectAgentWaitContinuationDeliveryExhausted
      .mockRejectedValueOnce(new Error('ASSISTANT_SETTLEMENT_DB_UNAVAILABLE'))
    const processor = getProcessor()

    await expect(processor({ id: 'outbox-1', data: { outboxId: 'outbox-1' } }))
      .rejects.toThrow('ASSISTANT_SETTLEMENT_DB_UNAVAILABLE')

    expect(repositoryMock.releaseOutboxCommand).toHaveBeenCalledTimes(1)
    expect(repositoryMock.releaseOutboxCommand).toHaveBeenCalledWith(expect.objectContaining({
      id: 'outbox-1',
      dead: false,
      error: 'ASSISTANT_SETTLEMENT_DB_UNAVAILABLE',
    }))
  })
})
