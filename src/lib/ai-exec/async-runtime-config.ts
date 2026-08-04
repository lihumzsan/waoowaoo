import { resolvePositiveIntegerConfig } from '@/lib/runtime-config/positive-integer'

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>

export { resolvePositiveIntegerConfig } from '@/lib/runtime-config/positive-integer'

export function getProviderGenerationTimeoutMs(env: RuntimeEnvironment = process.env): number {
  return resolvePositiveIntegerConfig({
    name: 'PROVIDER_GENERATION_TIMEOUT_MS',
    value: env.PROVIDER_GENERATION_TIMEOUT_MS,
    defaultValue: 20 * 60 * 1_000,
  })
}

/**
 * Queue wait budget for accepted external jobs (provider-reported `queued`
 * phase). Independent from `PROVIDER_GENERATION_TIMEOUT_MS`, which only meters the
 * `running` phase; exceeding this budget cancels the stuck job (best effort)
 * and retries with a fresh submission.
 */
export function getProviderQueueTimeoutMs(env: RuntimeEnvironment = process.env): number {
  return resolvePositiveIntegerConfig({
    name: 'PROVIDER_QUEUE_TIMEOUT_MS',
    value: env.PROVIDER_QUEUE_TIMEOUT_MS,
    defaultValue: 30 * 60 * 1_000,
  })
}

export function getProviderPollIntervalMs(env: RuntimeEnvironment = process.env): number {
  return resolvePositiveIntegerConfig({
    name: 'PROVIDER_POLL_INTERVAL_MS',
    value: env.PROVIDER_POLL_INTERVAL_MS,
    defaultValue: 3_000,
  })
}
