import { describe, expect, it } from 'vitest'
import type { SSEEvent } from '@/lib/sse/events'
import {
  SseBootstrapBufferOverflowError,
  SseEventIdentityConflictError,
  SseEventIdentityWindowOverflowError,
  WorkspaceSseServerSession,
} from '@/lib/sse/server-session'
import { lifecycleEvent } from './sse-test-fixtures'

describe('workspace SSE server session', () => {
  it('emits bootstrap before buffered live events and then switches to live mode', () => {
    const emitted: SSEEvent[] = []
    const session = new WorkspaceSseServerSession((event) => emitted.push(event))
    const bootstrap = lifecycleEvent('10', 10)
    const duringBootstrap = lifecycleEvent('11', 20)
    const live = lifecycleEvent('12', 30)

    session.receiveLiveEvent(duringBootstrap)
    session.completeBootstrap([bootstrap])
    session.receiveLiveEvent(live)

    expect(emitted).toEqual([bootstrap, duringBootstrap, live])
  })

  it('deduplicates an identical event across snapshot and buffer', () => {
    const emitted: SSEEvent[] = []
    const session = new WorkspaceSseServerSession((event) => emitted.push(event))
    const snapshot = lifecycleEvent('10', 10)
    const sameIdentity = lifecycleEvent('10', 10)

    session.receiveLiveEvent(sameIdentity)
    session.completeBootstrap([snapshot])

    expect(emitted).toEqual([snapshot])
  })

  it('fails explicitly when the same namespaced event identity carries different facts', () => {
    const session = new WorkspaceSseServerSession(() => undefined)
    session.receiveLiveEvent(lifecycleEvent('10', 20))

    expect(() => session.completeBootstrap([lifecycleEvent('10', 10)]))
      .toThrow(SseEventIdentityConflictError)
  })

  it('fails explicitly when live traffic exceeds the bounded bootstrap buffer', () => {
    const session = new WorkspaceSseServerSession(() => undefined, 1)
    session.receiveLiveEvent(lifecycleEvent('10', 10))

    expect(() => session.receiveLiveEvent(lifecycleEvent('11', 20)))
      .toThrow(SseBootstrapBufferOverflowError)
  })

  it('deduplicates an identical identity during live delivery', () => {
    const emitted: SSEEvent[] = []
    const session = new WorkspaceSseServerSession((event) => emitted.push(event))
    const event = lifecycleEvent('10', 10)

    session.completeBootstrap([])
    session.receiveLiveEvent(event)
    session.receiveLiveEvent({ ...event })

    expect(emitted).toEqual([event])
  })

  it('fails explicitly when a live identity changes fingerprint', () => {
    const session = new WorkspaceSseServerSession(() => undefined)

    session.completeBootstrap([])
    session.receiveLiveEvent(lifecycleEvent('10', 10))

    expect(() => session.receiveLiveEvent(lifecycleEvent('10', 20)))
      .toThrow(SseEventIdentityConflictError)
  })

  it('requires a new snapshot instead of evicting live identity fingerprints', () => {
    const session = new WorkspaceSseServerSession(() => undefined, 10, 1)

    session.completeBootstrap([])
    session.receiveLiveEvent(lifecycleEvent('10', 10))

    expect(() => session.receiveLiveEvent(lifecycleEvent('11', 20)))
      .toThrow(SseEventIdentityWindowOverflowError)
  })
})
