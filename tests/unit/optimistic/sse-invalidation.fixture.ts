import { beforeEach, describe, expect, it, vi } from 'vitest'

import { queryKeys } from '@/lib/query/keys'

import { TASK_EVENT_TYPE, TASK_SSE_EVENT_TYPE, WORKSPACE_SSE_EVENT_TYPE } from '@/lib/task/types'

type InvalidateArg = { queryKey?: readonly unknown[]; exact?: boolean; type?: 'active' | 'all' | 'inactive' }

type EffectCleanup = (() => void) | void | null

const runtime = vi.hoisted(() => ({
  queryClient: {
    invalidateQueries: vi.fn<(arg?: InvalidateArg) => Promise<void>>(async () => undefined),
    refetchQueries: vi.fn<(arg?: InvalidateArg) => Promise<void>>(async () => undefined),
    setQueryData: vi.fn(),
    getQueriesData: vi.fn(() => []),
  },
  effectCleanup: null as EffectCleanup,
  scheduledTimers: [] as Array<() => void>,
  scheduledIntervals: [] as Array<() => void>,
}))

const overlayMock = vi.hoisted(() => ({
  applyTaskLifecycleToOverlay: vi.fn(),
}))

const apiFetchMock = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}))

class FakeEventSource {
  static OPEN = 1
  static instances: FakeEventSource[] = []

  readonly url: string
  readyState = FakeEventSource.OPEN
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  private listeners = new Map<string, Set<EventListener>>()

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, handler: EventListener) {
    const set = this.listeners.get(type) || new Set<EventListener>()
    set.add(handler)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, handler: EventListener) {
    const set = this.listeners.get(type)
    if (!set) return
    set.delete(handler)
  }

  emit(type: string, payload: unknown) {
    const event = { data: JSON.stringify(payload) } as MessageEvent
    if (this.onmessage) this.onmessage(event)
    const set = this.listeners.get(type)
    if (!set) return
    for (const handler of set) {
      handler(event as unknown as Event)
    }
  }

  close() {
    this.readyState = 2
  }
}

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useCallback: <T,>(callback: T) => callback,
    useMemo: <T,>(factory: () => T) => factory(),
    useRef: <T,>(value: T) => ({ current: value }),
    useEffect: (effect: () => EffectCleanup) => {
      runtime.effectCleanup = effect()
    },
  }
})

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => runtime.queryClient,
}))

vi.mock('@/lib/query/task-target-overlay', () => overlayMock)

vi.mock('@/lib/api-fetch', () => apiFetchMock)

function hasInvalidation(predicate: (arg: InvalidateArg) => boolean) {
  return runtime.queryClient.invalidateQueries.mock.calls.some((call) => {
    const arg = (call[0] || {}) as InvalidateArg
    return predicate(arg)
  })
}

export { beforeEach, describe, expect, it, vi } from 'vitest'
export { queryKeys } from '@/lib/query/keys'
export { TASK_EVENT_TYPE, TASK_SSE_EVENT_TYPE, WORKSPACE_SSE_EVENT_TYPE } from '@/lib/task/types'
export { FakeEventSource, apiFetchMock, hasInvalidation, overlayMock, runtime }
export type { EffectCleanup, InvalidateArg }
