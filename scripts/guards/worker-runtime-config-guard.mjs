#!/usr/bin/env node

// Architecture contract: docs/architecture/modules/async-task-lifecycle.md (TL-02B).

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function inspectWorkerRuntimeConfigContract(input) {
  const violations = []
  for (const target of ['image', 'video', 'music', 'text', 'outbox']) {
    if (!input.runtimeConfig.includes(`${target}: { env:`)) {
      violations.push(`worker runtime registry is missing ${target}`)
    }
    if (!input.workers.includes(`getWorkerConcurrency('${target}')`)) {
      violations.push(`worker does not consume shared concurrency config: ${target}`)
    }
  }
  for (const required of [
    'resolvePositiveIntegerConfig',
    'getWorkerExternalTimeoutMs',
    'getWorkerExternalPollMs',
    'getTaskReconcilerRuntimeConfig',
    'getOutboxRuntimeConfig',
    "name: 'OUTBOX_MAX_DELIVERY_ATTEMPTS'",
  ]) {
    if (!input.runtimeConfig.includes(required)) {
      violations.push(`worker runtime config is missing fail-closed contract: ${required}`)
    }
  }
  if (!input.workers.includes('const currentAttempt = row.deliveryCount')) {
    violations.push('Outbox dead-letter ownership must use durable row.deliveryCount')
  }
  if (input.workers.includes('const currentAttempt = job.attemptsMade')) {
    violations.push('BullMQ attemptsMade must not own Outbox dead-letter state')
  }
  if (/Number\.parseInt\(process\.env\.(?:QUEUE_CONCURRENCY|WORKER_EXTERNAL)/.test(input.workers)) {
    violations.push('worker runtime config must not restore distributed parse/fallback logic')
  }
  for (const required of ['getTaskReconcilerRuntimeConfig()', 'getOutboxRuntimeConfig()']) {
    if (!input.workers.includes(required)) {
      violations.push(`queue lifecycle does not consume shared runtime config: ${required}`)
    }
  }
  if (!input.redis.includes('resolveRedisRuntimeConfig()')) {
    violations.push('Redis clients must consume the shared fail-closed runtime config')
  }
  for (const required of [
    'resolvePositiveIntegerConfig',
    'maxValue: 65_535',
    'BOOLEAN_CONFIG_INVALID:REDIS_TLS',
  ]) {
    if (!input.redisConfig.includes(required)) {
      violations.push(`Redis runtime config is missing contract: ${required}`)
    }
  }
  if (/Number\.parseInt\(process\.env\.REDIS_PORT/.test(input.redis)) {
    violations.push('Redis port must not restore a silent parse fallback')
  }
  return violations
}

function runCli() {
  const root = process.cwd()
  const workerFiles = [
    'src/lib/workers/image.worker.ts',
    'src/lib/workers/video.worker.ts',
    'src/lib/workers/music.worker.ts',
    'src/lib/workers/text.worker.ts',
    'src/lib/workers/outbox.worker.ts',
    'src/lib/workers/utils.ts',
    'src/lib/task/reconcile.ts',
    'src/lib/outbox/dispatcher.ts',
  ]
  const violations = inspectWorkerRuntimeConfigContract({
    runtimeConfig: fs.readFileSync(path.join(root, 'src/lib/workers/runtime-config.ts'), 'utf8'),
    workers: workerFiles.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n'),
    redis: fs.readFileSync(path.join(root, 'src/lib/redis.ts'), 'utf8'),
    redisConfig: fs.readFileSync(path.join(root, 'src/lib/redis-config.ts'), 'utf8'),
  })
  if (violations.length > 0) {
    console.error('[worker-runtime-config] violations detected')
    for (const violation of violations) console.error(`- ${violation}`)
    process.exit(1)
  }
  console.log('[worker-runtime-config] OK exhaustive worker registry + fail-closed integers')
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : null
if (entryHref && import.meta.url === entryHref) runCli()
