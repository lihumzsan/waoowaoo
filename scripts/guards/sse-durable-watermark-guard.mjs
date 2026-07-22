#!/usr/bin/env node

// Architecture contract: docs/architecture/modules/async-task-lifecycle.md (TL-09).

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function inspectSseDurableWatermarkContract(input) {
  const violations = []
  if (input.client.includes('/api/sse/replay') || input.client.includes('setInterval(')) {
    violations.push('SSE client must not poll replay for correctness')
  }
  if (input.legacyReplayRouteExists) violations.push('legacy JSON replay route must remain deleted')
  for (const required of [
    'window.sessionStorage',
    "params.set('cursor', serializeWorkspaceSseCursor(cursor))",
    'event.lastEventId',
  ]) {
    if (!input.client.includes(required)) violations.push(`SSE client durable cursor step missing: ${required}`)
  }
  for (const required of [
    'taskEventId',
    'agentEventId',
    'resourceEventAtMs',
    'resourceOutboxId',
    'v4;',
    'advanceWorkspaceSseCursor',
  ]) {
    if (!input.protocol.includes(required)) violations.push(`SSE composite cursor contract missing: ${required}`)
  }
  for (const forbidden of ['v1;', 'v2;', 'v3;']) {
    if (input.protocol.includes(forbidden)) violations.push(`SSE obsolete cursor protocol restored: ${forbidden}`)
  }
  if (!input.client.includes('workspace-sse-cursor:v4:')) {
    violations.push('SSE client storage key must isolate the v4 resource watermark protocol')
  }
  for (const required of [
    'listWorkspaceResourceReplayEvents',
    'resourceEvents.length === replayLimit',
    'buildRecoveryResourceCheckpoint',
  ]) {
    if (!input.bootstrap.includes(required)) {
      violations.push(`SSE resource replay recovery contract missing: ${required}`)
    }
  }
  if (!input.client.includes('isWorkspaceSseEvent')) {
    violations.push('SSE client must use the protocol-owned event validator')
  }
  const subscribeIndex = input.route.indexOf('await sharedSubscriber.addChannelListener(')
  const bootstrapIndex = input.route.indexOf("operationId: 'get_sse_bootstrap'")
  if (subscribeIndex < 0 || bootstrapIndex < 0 || subscribeIndex >= bootstrapIndex) {
    violations.push('SSE route must subscribe before reading the bootstrap snapshot')
  }
  if (!input.route.includes("request.nextUrl.searchParams.get('cursor')")) {
    violations.push('SSE route must accept the durable initial cursor')
  }
  if (input.eventAppend && !input.eventAppend.includes('createSessionBroadcastOutbox(tx, createdEvent.id)')) {
    violations.push('ProjectAgentEvent append must create the Assistant broadcast Outbox in the same transaction')
  }
  if (input.outboxWorker && !input.outboxWorker.includes('publishPersistedProjectAgentSessionChangedById')) {
    violations.push('Outbox worker must remain the sole Assistant Session publisher')
  }
  if (input.assistantRuntime && !input.assistantRuntime.includes('PROJECT_AGENT_SESSION_STATE_STALE')) {
    violations.push('Assistant runtime must reject Session responses older than the Assistant event watermark')
  }
  for (const required of [
    'getWorkspaceSseEventIdentity',
    'processedEventFingerprints',
    'event_identity_conflict',
    'event_identity_window_overflow',
  ]) {
    if (!input.clientSequence?.includes(required)) {
      violations.push(`SSE client identity/fingerprint contract missing: ${required}`)
    }
  }
  for (const required of [
    'getWorkspaceSseEventIdentity',
    'emittedIdentities',
    'SseEventIdentityConflictError',
    'SseEventIdentityWindowOverflowError',
  ]) {
    if (!input.serverSession?.includes(required)) {
      violations.push(`SSE server live identity/fingerprint contract missing: ${required}`)
    }
  }
  if (!input.client.includes('requestSnapshotResync()')) {
    violations.push('SSE client identity conflict must request a snapshot resync')
  }
  if (input.publisherCallerFiles) {
    const unexpected = input.publisherCallerFiles.filter((file) => file !== 'src/lib/workers/outbox.worker.ts')
    if (unexpected.length > 0 || !input.publisherCallerFiles.includes('src/lib/workers/outbox.worker.ts')) {
      violations.push(`Assistant Session publisher callers must be Outbox-only: ${input.publisherCallerFiles.join(', ')}`)
    }
  }
  return violations
}

function listFilesRecursively(root) {
  const files = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...listFilesRecursively(absolute))
    else if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name)) files.push(absolute)
  }
  return files
}

function runCli() {
  const cwd = process.cwd()
  const read = (file) => fs.readFileSync(path.join(cwd, file), 'utf8')
  const publisherName = 'publishPersistedProjectAgentSessionChangedById'
  const publisherDefinition = path.join(cwd, 'src/lib/project-agent/session-event.ts')
  const publisherCallerFiles = listFilesRecursively(path.join(cwd, 'src'))
    .filter((file) => file !== publisherDefinition && fs.readFileSync(file, 'utf8').includes(publisherName))
    .map((file) => path.relative(cwd, file))
  const violations = inspectSseDurableWatermarkContract({
    client: read('src/lib/query/hooks/useSSE.ts'),
    protocol: read('src/lib/sse/protocol.ts'),
    bootstrap: read('src/lib/operations/domains/debug/sse-ops.ts'),
    route: read('src/app/api/sse/route.ts'),
    eventAppend: read('src/lib/project-agent/event/append.ts'),
    outboxWorker: read('src/lib/workers/outbox.worker.ts'),
    assistantRuntime: read('src/features/project-workspace/components/workspace-assistant/useWorkspaceAssistantSessionSync.ts'),
    clientSequence: read('src/lib/query/workspace-sse-event-sequence.ts'),
    serverSession: read('src/lib/sse/server-session.ts'),
    publisherCallerFiles,
    legacyReplayRouteExists: fs.existsSync(path.join(cwd, 'src/app/api/sse/replay/route.ts')),
  })
  if (violations.length > 0) {
    console.error('[sse-durable-watermark] violations detected')
    for (const violation of violations) console.error(`- ${violation}`)
    process.exit(1)
  }
  console.log('[sse-durable-watermark] OK Task/Assistant/Resource durable cursor + subscribe-before-bootstrap')
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
if (entryHref && import.meta.url === entryHref) runCli()
