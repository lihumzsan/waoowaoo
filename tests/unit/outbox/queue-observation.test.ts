import { describe, expect, it, vi } from 'vitest'
import { observeOutboxJobWithQueue } from '@/lib/outbox/queue'

describe('Outbox queue observation', () => {
  it('does not interpret Redis unavailability as an absent job', async () => {
    const queue = {
      getJob: vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }),
    }
    await expect(observeOutboxJobWithQueue('outbox-1', queue)).resolves.toBe('unavailable')
    expect(queue.getJob).toHaveBeenCalledWith('outbox-1')
  })
})
