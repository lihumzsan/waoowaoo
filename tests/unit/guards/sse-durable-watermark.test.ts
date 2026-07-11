import { describe, expect, it } from 'vitest'
import { inspectSseDurableWatermarkContract } from '../../../scripts/guards/sse-durable-watermark-guard.mjs'

const valid = {
  client: [
    'window.sessionStorage',
    "params.set('cursor', serializeWorkspaceSseCursor(cursor))",
    'event.lastEventId',
    'requestSnapshotResync()',
  ].join('\n'),
  protocol: 'taskEventId\nmutationEventAtMs\nmutationBatchId\nagentEventId\nv2;\nadvanceWorkspaceSseCursor',
  route: [
    "request.nextUrl.searchParams.get('cursor')",
    'await sharedSubscriber.addChannelListener(',
    "operationId: 'get_sse_bootstrap'",
  ].join('\n'),
  legacyReplayRouteExists: false,
  eventAppend: 'createSessionBroadcastOutbox(tx, createdEvent.id)',
  outboxWorker: 'publishPersistedProjectAgentSessionChangedById',
  assistantRuntime: 'PROJECT_AGENT_SESSION_STATE_STALE',
  clientSequence: 'getWorkspaceSseEventIdentity\nprocessedEventFingerprints\nevent_identity_conflict\nevent_identity_window_overflow',
  serverSession: 'getWorkspaceSseEventIdentity\nemittedIdentities\nSseEventIdentityConflictError\nSseEventIdentityWindowOverflowError',
  publisherCallerFiles: ['src/lib/workers/outbox.worker.ts'],
}

describe('SSE durable watermark guard', () => {
  it('accepts the composite cursor handshake', () => {
    expect(inspectSseDurableWatermarkContract(valid)).toEqual([])
  })

  it('rejects replay polling and bootstrap-before-subscribe', () => {
    expect(inspectSseDurableWatermarkContract({
      ...valid,
      client: `${valid.client}\nsetInterval(() => fetch('/api/sse/replay'))`,
      route: [
        "request.nextUrl.searchParams.get('cursor')",
        "operationId: 'get_sse_bootstrap'",
        'await sharedSubscriber.addChannelListener(',
      ].join('\n'),
    })).toEqual(expect.arrayContaining([
      'SSE client must not poll replay for correctness',
      'SSE route must subscribe before reading the bootstrap snapshot',
    ]))
  })
})
