import { describe, expect, it } from 'vitest'
import { LatestSaveQueue } from '@/lib/user-api/latest-save-queue'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('LatestSaveQueue', () => {
  it('serializes writes and coalesces queued inputs to the latest value', async () => {
    const first = deferred<string>()
    const latest = deferred<string>()
    const started: number[] = []
    let active = 0
    let maxActive = 0

    const queue = new LatestSaveQueue<number, string>(async (value) => {
      started.push(value)
      active += 1
      maxActive = Math.max(maxActive, active)
      try {
        return await (value === 1 ? first.promise : latest.promise)
      } finally {
        active -= 1
      }
    })

    const firstResult = queue.submit(1)
    const supersededResult = queue.submit(2)
    const latestResult = queue.submit(3)

    expect(started).toEqual([1])
    expect(maxActive).toBe(1)

    first.resolve('saved-1')
    await expect(firstResult).resolves.toEqual({
      ok: true,
      value: 'saved-1',
      isLatest: false,
    })
    expect(started).toEqual([1, 3])
    expect(maxActive).toBe(1)

    latest.resolve('saved-3')
    await expect(supersededResult).resolves.toEqual({
      ok: true,
      value: 'saved-3',
      isLatest: true,
    })
    await expect(latestResult).resolves.toEqual({
      ok: true,
      value: 'saved-3',
      isLatest: true,
    })
    await expect(queue.waitForIdle()).resolves.toEqual({
      ok: true,
      value: 'saved-3',
      isLatest: true,
    })
    expect(maxActive).toBe(1)
  })

  it('continues with the latest queued input after an earlier write fails', async () => {
    const first = deferred<string>()
    const latest = deferred<string>()
    const started: number[] = []
    const failure = new Error('first save failed')
    const queue = new LatestSaveQueue<number, string>(async (value) => {
      started.push(value)
      return await (value === 1 ? first.promise : latest.promise)
    })

    const firstResult = queue.submit(1)
    const latestResult = queue.submit(2)
    first.reject(failure)

    await expect(firstResult).resolves.toEqual({
      ok: false,
      error: failure,
      isLatest: false,
    })
    expect(started).toEqual([1, 2])

    latest.resolve('saved-2')
    await expect(latestResult).resolves.toEqual({
      ok: true,
      value: 'saved-2',
      isLatest: true,
    })
  })

  it('does not resolve the idle barrier until the latest queued write settles', async () => {
    const first = deferred<string>()
    const latest = deferred<string>()
    const latestFailure = new Error('latest save failed')
    const queue = new LatestSaveQueue<number, string>(async (value) => (
      await (value === 1 ? first.promise : latest.promise)
    ))

    const firstResult = queue.submit(1)
    const barrier = queue.waitForIdle()
    const latestResult = queue.submit(2)
    first.resolve('saved-1')

    await expect(firstResult).resolves.toEqual({
      ok: true,
      value: 'saved-1',
      isLatest: false,
    })
    let barrierSettled = false
    void barrier.finally(() => { barrierSettled = true })
    await Promise.resolve()
    expect(barrierSettled).toBe(false)

    latest.reject(latestFailure)
    await expect(latestResult).resolves.toEqual({
      ok: false,
      error: latestFailure,
      isLatest: true,
    })
    await expect(barrier).resolves.toEqual({
      ok: false,
      error: latestFailure,
      isLatest: true,
    })
  })
})
