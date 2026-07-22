import { describe, expect, it, vi } from 'vitest'
import {
  createVideoSeamRequestCoordinator,
  requestVideoSeamTaskStatus,
} from '@/app/[locale]/workspace/video-tools/video-seam-request-coordinator'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('video seam request coordinator', () => {
  it('reuses an in-flight task status request for the same user and task', async () => {
    let currentUserId: string | null = 'user-1'
    const coordinator = createVideoSeamRequestCoordinator({
      getCurrentUserId: () => currentUserId,
    })
    const request = deferred<string>()
    const execute = vi.fn(() => request.promise)
    const onSuccess = vi.fn()

    const first = coordinator.run({
      kind: 'task_status',
      userId: 'user-1',
      requestKey: 'task-1',
      reuseInFlight: true,
      execute,
      onSuccess,
    })
    const second = coordinator.run({
      kind: 'task_status',
      userId: 'user-1',
      requestKey: 'task-1',
      reuseInFlight: true,
      execute,
      onSuccess,
    })

    expect(first).toBe(second)
    expect(execute).toHaveBeenCalledOnce()
    request.resolve('processing')
    await first
    expect(onSuccess).toHaveBeenCalledWith('processing')
    currentUserId = null
  })

  it('aborts an older same-kind request and prevents its late response from regressing terminal state', async () => {
    let currentUserId: string | null = 'user-1'
    const coordinator = createVideoSeamRequestCoordinator({
      getCurrentUserId: () => currentUserId,
    })
    const oldRequest = deferred<string>()
    const currentRequest = deferred<string>()
    const oldSignals: AbortSignal[] = []
    let phase = 'queued'

    const oldRun = coordinator.run({
      kind: 'task_status',
      userId: 'user-1',
      requestKey: 'task-1',
      execute: (signal) => {
        oldSignals.push(signal)
        return oldRequest.promise
      },
      onSuccess: (value) => { phase = value },
    })
    const currentRun = coordinator.run({
      kind: 'task_status',
      userId: 'user-1',
      requestKey: 'task-1',
      execute: () => currentRequest.promise,
      onSuccess: (value) => { phase = value },
    })

    expect(oldSignals[0]?.aborted).toBe(true)
    currentRequest.resolve('completed')
    await currentRun
    oldRequest.resolve('processing')
    await oldRun
    expect(phase).toBe('completed')
    currentUserId = null
  })

  it('aborts every request on user change and ignores the old user rejection', async () => {
    let currentUserId: string | null = 'user-1'
    const coordinator = createVideoSeamRequestCoordinator({
      getCurrentUserId: () => currentUserId,
    })
    const request = deferred<string>()
    const onError = vi.fn()
    const signals: AbortSignal[] = []
    const run = coordinator.run({
      kind: 'task_status',
      userId: 'user-1',
      requestKey: 'task-1',
      execute: (requestSignal) => {
        signals.push(requestSignal)
        return request.promise
      },
      onSuccess: vi.fn(),
      onError,
    })

    currentUserId = 'user-2'
    coordinator.abortAll()
    request.reject(new TypeError('late user-1 failure'))
    await run

    expect(signals[0]?.aborted).toBe(true)
    expect(onError).not.toHaveBeenCalled()
  })

  it.each([
    ['success', true],
    ['failure', false],
  ])('does not apply a late old-user upload %s or its cleanup', async (_case, succeeds) => {
    let currentUserId: string | null = 'user-1'
    const coordinator = createVideoSeamRequestCoordinator({
      getCurrentUserId: () => currentUserId,
    })
    const request = deferred<{ url: string }>()
    let inputUrl: string | null = null
    let error: string | null = null
    let uploading = true
    const run = coordinator.run({
      kind: 'upload',
      userId: 'user-1',
      requestKey: 'input1',
      execute: () => request.promise,
      onSuccess: (value) => { inputUrl = value.url },
      onError: (reason) => { error = reason instanceof Error ? reason.message : 'upload failed' },
      onSettled: () => { uploading = false },
    })

    currentUserId = 'user-2'
    coordinator.abortAll()
    uploading = false
    if (succeeds) request.resolve({ url: '/signed/user-1.mp4' })
    else request.reject(new TypeError('old upload failed'))
    await run

    expect(inputUrl).toBeNull()
    expect(error).toBeNull()
    expect(uploading).toBe(false)
  })

  it.each([
    ['success', true],
    ['failure', false],
  ])('does not apply a late old-user submit %s or its cleanup', async (_case, succeeds) => {
    let currentUserId: string | null = 'user-1'
    const coordinator = createVideoSeamRequestCoordinator({
      getCurrentUserId: () => currentUserId,
    })
    const request = deferred<{ taskId: string }>()
    let taskId: string | null = null
    let error: string | null = null
    let submitting = true
    const run = coordinator.run({
      kind: 'submit',
      userId: 'user-1',
      execute: () => request.promise,
      onSuccess: (value) => { taskId = value.taskId },
      onError: (reason) => { error = reason instanceof Error ? reason.message : 'submit failed' },
      onSettled: () => { submitting = false },
    })

    currentUserId = 'user-2'
    coordinator.abortAll()
    submitting = false
    if (succeeds) request.resolve({ taskId: 'user-1-task' })
    else request.reject(new TypeError('old submit failed'))
    await run

    expect(taskId).toBeNull()
    expect(error).toBeNull()
    expect(submitting).toBe(false)
  })

  it('classifies missing, successful, and server-failed task status responses', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(Response.json({ id: 'task-1', status: 'processing' }))
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))

    await expect(requestVideoSeamTaskStatus({
      taskId: 'task-1',
      signal: new AbortController().signal,
      statusFailedMessage: 'status failed',
      fetcher,
    })).resolves.toEqual({ kind: 'missing' })
    await expect(requestVideoSeamTaskStatus({
      taskId: 'task-1',
      signal: new AbortController().signal,
      statusFailedMessage: 'status failed',
      fetcher,
    })).resolves.toEqual({
      kind: 'task',
      task: { id: 'task-1', status: 'processing' },
    })
    await expect(requestVideoSeamTaskStatus({
      taskId: 'task-1',
      signal: new AbortController().signal,
      statusFailedMessage: 'status failed',
      fetcher,
    })).rejects.toThrow('status failed')
  })
})
