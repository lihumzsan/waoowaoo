import {
  isAgentTurnStreamSseEvent,
  type SSEEvent,
} from '@/lib/sse/events'
import { getWorkspaceSseEventIdentity } from './protocol'

export const DEFAULT_SSE_BOOTSTRAP_BUFFER_LIMIT = 1000
export const DEFAULT_SSE_EVENT_IDENTITY_LIMIT = 2048

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

export class SseEventIdentityWindowOverflowError extends Error {
  constructor(limit: number) {
    super(`SSE_EVENT_IDENTITY_WINDOW_OVERFLOW limit=${String(limit)}`)
    this.name = 'SseEventIdentityWindowOverflowError'
  }
}

type SessionPhase = 'buffering' | 'live' | 'closed'

export class WorkspaceSseServerSession {
  private phase: SessionPhase = 'buffering'
  private bufferedEvents: SSEEvent[] = []
  private readonly emittedIdentities = new Map<string, string>()

  constructor(
    private readonly emit: (event: SSEEvent) => void,
    private readonly bufferLimit = DEFAULT_SSE_BOOTSTRAP_BUFFER_LIMIT,
    private readonly identityLimit = DEFAULT_SSE_EVENT_IDENTITY_LIMIT,
  ) {
    if (!Number.isInteger(bufferLimit) || bufferLimit <= 0) {
      throw new Error('SSE_BOOTSTRAP_BUFFER_LIMIT_INVALID')
    }
    if (!Number.isInteger(identityLimit) || identityLimit <= 0) {
      throw new Error('SSE_EVENT_IDENTITY_LIMIT_INVALID')
    }
  }

  private emitOnce(event: SSEEvent): void {
    const identity = getWorkspaceSseEventIdentity(event)
    const existingFingerprint = this.emittedIdentities.get(identity.key)
    if (existingFingerprint === identity.fingerprint) return
    if (existingFingerprint !== undefined) {
      throw new SseEventIdentityConflictError(identity.key)
    }
    if (this.emittedIdentities.size >= this.identityLimit) {
      throw new SseEventIdentityWindowOverflowError(this.identityLimit)
    }
    this.emit(event)
    this.emittedIdentities.set(identity.key, identity.fingerprint)
  }

  receiveLiveEvent(event: SSEEvent): void {
    if (this.phase === 'closed') return
    if (this.phase === 'live') {
      if (isAgentTurnStreamSseEvent(event)) this.emit(event)
      else this.emitOnce(event)
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
    for (const event of events) {
      if (isAgentTurnStreamSseEvent(event)) {
        throw new Error('SSE_BOOTSTRAP_EPHEMERAL_EVENT_FORBIDDEN')
      }
      this.emitOnce(event)
    }
    const buffered = this.bufferedEvents
    this.bufferedEvents = []
    this.phase = 'live'
    for (const event of buffered) {
      if (isAgentTurnStreamSseEvent(event)) this.emit(event)
      else this.emitOnce(event)
    }
  }

  close(): void {
    this.phase = 'closed'
    this.bufferedEvents = []
    this.emittedIdentities.clear()
  }
}
