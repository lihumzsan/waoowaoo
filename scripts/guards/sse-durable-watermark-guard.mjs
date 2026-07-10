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
    'mutationEventAtMs',
    'mutationBatchId',
    'advanceWorkspaceSseCursor',
  ]) {
    if (!input.protocol.includes(required)) violations.push(`SSE composite cursor contract missing: ${required}`)
  }
  const subscribeIndex = input.route.indexOf('await sharedSubscriber.addChannelListener(')
  const bootstrapIndex = input.route.indexOf("operationId: 'get_sse_bootstrap'")
  if (subscribeIndex < 0 || bootstrapIndex < 0 || subscribeIndex >= bootstrapIndex) {
    violations.push('SSE route must subscribe before reading the bootstrap snapshot')
  }
  if (!input.route.includes("request.nextUrl.searchParams.get('cursor')")) {
    violations.push('SSE route must accept the durable initial cursor')
  }
  return violations
}

function runCli() {
  const cwd = process.cwd()
  const read = (file) => fs.readFileSync(path.join(cwd, file), 'utf8')
  const violations = inspectSseDurableWatermarkContract({
    client: read('src/lib/query/hooks/useSSE.ts'),
    protocol: read('src/lib/sse/protocol.ts'),
    route: read('src/app/api/sse/route.ts'),
    legacyReplayRouteExists: fs.existsSync(path.join(cwd, 'src/app/api/sse/replay/route.ts')),
  })
  if (violations.length > 0) {
    console.error('[sse-durable-watermark] violations detected')
    for (const violation of violations) console.error(`- ${violation}`)
    process.exit(1)
  }
  console.log('[sse-durable-watermark] OK composite durable cursor + subscribe-before-bootstrap')
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
if (entryHref && import.meta.url === entryHref) runCli()
