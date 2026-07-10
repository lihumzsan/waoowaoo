import type { SSEEvent } from '@/lib/task/types'
import { getWorkspaceSseEventIdentity } from './protocol'

export const DEFAULT_SSE_BOOTSTRAP_BUFFER_LIMIT = 1000

export class SseBootstrapBufferOverflowError extends Error {
  constructor(limit: number) {
    super(`SSE_BOOTSTRAP_BUFFER_OVERFLOW limit=${String(limit)}`)
    this.name = 'SseBootstrapBufferOverflowError'
  }
}

export class SseEventIdentityConflictError extends Error {
  constructor(key: string) {
    super(`SSE_EVENT_IDENTITY_CONFLICT key=${key}`)
    this.name = 'SseEventIdentityConflictError'
  }
}

type SessionPhase = 'buffering' | 'live' | 'closed'

export class WorkspaceSseServerSession {
  private phase: SessionPhase = 'buffering'
  private bufferedEvents: SSEEvent[] = []

  constructor(
    private readonly emit: (event: SSEEvent) => void,
    private readonly bufferLimit = DEFAULT_SSE_BOOTSTRAP_BUFFER_LIMIT,
  ) {
    if (!Number.isInteger(bufferLimit) || bufferLimit <= 0) {
      throw new Error('SSE_BOOTSTRAP_BUFFER_LIMIT_INVALID')
    }
  }

  receiveLiveEvent(event: SSEEvent): void {
    if (this.phase === 'closed') return
    if (this.phase === 'live') {
      this.emit(event)
      return
    }
    if (this.bufferedEvents.length >= this.bufferLimit) {
      throw new SseBootstrapBufferOverflowError(this.bufferLimit)
    }
    this.bufferedEvents.push(event)
  }

  completeBootstrap(events: readonly SSEEvent[]): void {
    if (this.phase !== 'buffering') {
      throw new Error(`SSE_BOOTSTRAP_PHASE_INVALID phase=${this.phase}`)
    }
    const emittedIdentities = new Map<string, string>()
    const emitOnce = (event: SSEEvent): void => {
      const identity = getWorkspaceSseEventIdentity(event)
      const existingFingerprint = emittedIdentities.get(identity.key)
      if (existingFingerprint === identity.fingerprint) return
      if (existingFingerprint !== undefined) {
        throw new SseEventIdentityConflictError(identity.key)
      }
      emittedIdentities.set(identity.key, identity.fingerprint)
      this.emit(event)
    }
    for (const event of events) {
      emitOnce(event)
    }
    const buffered = this.bufferedEvents
    this.bufferedEvents = []
    this.phase = 'live'
    for (const event of buffered) {
      emitOnce(event)
    }
  }

  close(): void {
    this.phase = 'closed'
    this.bufferedEvents = []
  }
}
