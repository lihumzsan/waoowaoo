import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import type { VideoToolTask } from './video-tools-state'

type VideoSeamRequestKind = 'task_status' | 'upload' | 'submit'

type VideoSeamRequestOptions<T> = {
  kind: VideoSeamRequestKind
  userId: string
  requestKey?: string
  reuseInFlight?: boolean
  execute: (signal: AbortSignal) => Promise<T>
  onSuccess: (value: T) => void
  onError?: (error: unknown) => void
  onSettled?: () => void
}

type ActiveVideoSeamRequest = {
  scope: string
  controller: AbortController
  promise: Promise<void>
  token: symbol
}

export type VideoSeamRequestCoordinator = {
  run: <T>(options: VideoSeamRequestOptions<T>) => Promise<void>
  abort: (kind: VideoSeamRequestKind) => void
  abortAll: () => void
}

export function createVideoSeamRequestCoordinator(options: {
  getCurrentUserId: () => string | null
}): VideoSeamRequestCoordinator {
  const activeRequests = new Map<VideoSeamRequestKind, ActiveVideoSeamRequest>()

  const abort = (kind: VideoSeamRequestKind) => {
    const active = activeRequests.get(kind)
    activeRequests.delete(kind)
    active?.controller.abort()
  }

  const run = <T,>(request: VideoSeamRequestOptions<T>): Promise<void> => {
    const scope = JSON.stringify([request.userId, request.requestKey || null])
    const existing = activeRequests.get(request.kind)
    if (request.reuseInFlight
      && existing?.scope === scope
      && !existing.controller.signal.aborted) return existing.promise
    if (existing) abort(request.kind)

    const controller = new AbortController()
    const token = Symbol(request.kind)
    const isCurrent = () => activeRequests.get(request.kind)?.token === token
      && !controller.signal.aborted
      && options.getCurrentUserId() === request.userId
    let execution: Promise<T>
    try {
      execution = request.execute(controller.signal)
    } catch (error) {
      execution = Promise.reject(error)
    }
    const promise = execution
      .then((value) => {
        if (isCurrent()) request.onSuccess(value)
      })
      .catch((error: unknown) => {
        if (isCurrent()) request.onError?.(error)
      })
      .finally(() => {
        if (!isCurrent()) return
        activeRequests.delete(request.kind)
        request.onSettled?.()
      })
    const active = { scope, controller, promise, token }
    activeRequests.set(request.kind, active)
    return promise
  }

  return {
    run,
    abort,
    abortAll: () => {
      for (const kind of [...activeRequests.keys()]) abort(kind)
    },
  }
}

export type VideoSeamTaskStatusOutcome =
  | { kind: 'missing' }
  | { kind: 'task'; task: VideoToolTask }

export async function requestVideoSeamTaskStatus(params: {
  taskId: string
  signal: AbortSignal
  statusFailedMessage: string
  fetcher?: typeof apiFetch
}): Promise<VideoSeamTaskStatusOutcome> {
  const search = new URLSearchParams({ taskId: params.taskId })
  const response = await (params.fetcher || apiFetch)(`/api/video-tools/seam-concat?${search}`, {
    signal: params.signal,
  })
  if (response.status === 404) return { kind: 'missing' }
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, params.statusFailedMessage))
  }
  return {
    kind: 'task',
    task: await response.json() as VideoToolTask,
  }
}
