import { resolvePositiveIntegerConfig } from '@/lib/runtime-config/positive-integer'

export type WorkerRuntimeTarget = 'image' | 'video' | 'music' | 'voice' | 'text' | 'outbox'
type RuntimeEnvironment = Readonly<Record<string, string | undefined>>

export { resolvePositiveIntegerConfig } from '@/lib/runtime-config/positive-integer'

const WORKER_CONCURRENCY_CONFIG = {
  image: { env: 'QUEUE_CONCURRENCY_IMAGE', defaultValue: 20 },
  video: { env: 'QUEUE_CONCURRENCY_VIDEO', defaultValue: 20 },
  // BGM is one-per-film by contract (AP-02); serialize provider calls.
  music: { env: 'QUEUE_CONCURRENCY_MUSIC', defaultValue: 1 },
  voice: { env: 'QUEUE_CONCURRENCY_VOICE', defaultValue: 20 },
  text: { env: 'QUEUE_CONCURRENCY_TEXT', defaultValue: 20 },
  outbox: { env: 'QUEUE_CONCURRENCY_OUTBOX', defaultValue: 10 },
} as const satisfies Record<WorkerRuntimeTarget, {
  readonly env: string
  readonly defaultValue: number
}>

export function getWorkerConcurrency(
  target: WorkerRuntimeTarget,
  env: RuntimeEnvironment = process.env,
): number {
  const config = WORKER_CONCURRENCY_CONFIG[target]
  return resolvePositiveIntegerConfig({
    name: config.env,
    value: env[config.env],
    defaultValue: config.defaultValue,
  })
}

export function getWorkerExternalTimeoutMs(env: RuntimeEnvironment = process.env): number {
  return resolvePositiveIntegerConfig({
    name: 'WORKER_EXTERNAL_TIMEOUT_MS',
    value: env.WORKER_EXTERNAL_TIMEOUT_MS,
    defaultValue: 20 * 60 * 1_000,
  })
}

/**
 * Queue wait budget for accepted external jobs (provider-reported `queued`
 * phase). Independent from `WORKER_EXTERNAL_TIMEOUT_MS`, which only meters the
 * `running` phase; exceeding this budget cancels the stuck job (best effort)
 * and retries with a fresh submission.
 */
export function getWorkerExternalQueueTimeoutMs(env: RuntimeEnvironment = process.env): number {
  return resolvePositiveIntegerConfig({
    name: 'WORKER_EXTERNAL_QUEUE_TIMEOUT_MS',
    value: env.WORKER_EXTERNAL_QUEUE_TIMEOUT_MS,
    defaultValue: 30 * 60 * 1_000,
  })
}

export function getWorkerExternalPollMs(env: RuntimeEnvironment = process.env): number {
  return resolvePositiveIntegerConfig({
    name: 'WORKER_EXTERNAL_POLL_MS',
    value: env.WORKER_EXTERNAL_POLL_MS,
    defaultValue: 3_000,
  })
}

export function getTaskReconcilerRuntimeConfig(env: RuntimeEnvironment = process.env) {
  return {
    intervalMs: resolvePositiveIntegerConfig({
      name: 'TASK_RECONCILE_INTERVAL_MS',
      value: env.TASK_RECONCILE_INTERVAL_MS,
      defaultValue: 60_000,
      minValue: 1_000,
    }),
    terminalGraceMs: resolvePositiveIntegerConfig({
      name: 'TASK_RECONCILE_TERMINAL_GRACE_MS',
      value: env.TASK_RECONCILE_TERMINAL_GRACE_MS,
      defaultValue: 90_000,
      minValue: 1_000,
    }),
    missingGraceMs: resolvePositiveIntegerConfig({
      name: 'TASK_RECONCILE_MISSING_GRACE_MS',
      value: env.TASK_RECONCILE_MISSING_GRACE_MS,
      defaultValue: 30_000,
      minValue: 1_000,
    }),
  }
}

export function getOutboxRuntimeConfig(env: RuntimeEnvironment = process.env) {
  return {
    dispatchIntervalMs: resolvePositiveIntegerConfig({
      name: 'OUTBOX_DISPATCH_INTERVAL_MS',
      value: env.OUTBOX_DISPATCH_INTERVAL_MS,
      defaultValue: 5_000,
      minValue: 1_000,
    }),
    staleEnqueuedMs: resolvePositiveIntegerConfig({
      name: 'OUTBOX_STALE_ENQUEUED_MS',
      value: env.OUTBOX_STALE_ENQUEUED_MS,
      defaultValue: 30_000,
      minValue: 1_000,
    }),
    leaseMs: resolvePositiveIntegerConfig({
      name: 'OUTBOX_LEASE_MS',
      value: env.OUTBOX_LEASE_MS,
      defaultValue: 30_000,
      minValue: 3_000,
    }),
    maxDeliveryAttempts: resolvePositiveIntegerConfig({
      name: 'OUTBOX_MAX_DELIVERY_ATTEMPTS',
      value: env.OUTBOX_MAX_DELIVERY_ATTEMPTS,
      defaultValue: 5,
      minValue: 1,
      maxValue: 100,
    }),
  }
}
