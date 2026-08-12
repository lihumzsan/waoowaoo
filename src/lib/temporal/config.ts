type RuntimeEnvironment = Readonly<Record<string, string | undefined>>

export interface TemporalRuntimeConfig {
  address: string
  namespace: string
  taskQueue: string
  apiKey: string | null
  tlsEnabled: boolean
  tlsServerName: string | null
}

export interface TemporalWorkerRuntimeConfig extends TemporalRuntimeConfig {
  workerDeploymentName: string
  workerBuildId: string
  workerVersioningEnabled: boolean
  workerReadyFile: string | null
}

function readOptionalString(env: RuntimeEnvironment, name: string): string | null {
  const value = env[name]?.trim()
  return value || null
}

function readRequiredString(env: RuntimeEnvironment, name: string): string {
  const value = readOptionalString(env, name)
  if (!value) throw new Error(`${name}_REQUIRED`)
  return value
}

function readBoolean(env: RuntimeEnvironment, name: string, defaultValue: boolean): boolean {
  const value = readOptionalString(env, name)
  if (value === null) return defaultValue
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name}_INVALID:${value}`)
}

function isProductionRuntime(env: RuntimeEnvironment): boolean {
  return env.NODE_ENV === 'production'
}

function readWorkerBuildId(env: RuntimeEnvironment, defaultValue: string | null): string {
  const buildId =
    readOptionalString(env, 'TEMPORAL_WORKER_BUILD_ID') ??
    defaultValue ??
    readRequiredString(env, 'TEMPORAL_WORKER_BUILD_ID')
  if (isProductionRuntime(env) && buildId.toLowerCase() === 'local') {
    throw new Error('TEMPORAL_WORKER_BUILD_ID_IMMUTABLE_REQUIRED')
  }
  return buildId
}

function readWorkerVersioningEnabled(env: RuntimeEnvironment): boolean {
  const enabled = readBoolean(env, 'TEMPORAL_WORKER_VERSIONING_ENABLED', true)
  if (!enabled) {
    throw new Error('TEMPORAL_WORKER_VERSIONING_REQUIRED')
  }
  return true
}

function readTemporalConnectionConfig(env: RuntimeEnvironment): TemporalRuntimeConfig {
  const apiKey = readOptionalString(env, 'TEMPORAL_API_KEY')
  const tlsEnabled = readBoolean(env, 'TEMPORAL_TLS_ENABLED', false)
  const tlsServerName = readOptionalString(env, 'TEMPORAL_TLS_SERVER_NAME')
  if (apiKey && !tlsEnabled) {
    throw new Error('TEMPORAL_API_KEY_REQUIRES_TLS')
  }
  if (tlsServerName && !tlsEnabled) {
    throw new Error('TEMPORAL_TLS_SERVER_NAME_REQUIRES_TLS')
  }
  return {
    address: readOptionalString(env, 'TEMPORAL_ADDRESS') ?? '127.0.0.1:17233',
    namespace: readOptionalString(env, 'TEMPORAL_NAMESPACE') ?? 'waoowaoo',
    taskQueue: readOptionalString(env, 'TEMPORAL_TASK_QUEUE') ?? 'waoowaoo-runtime',
    apiKey,
    tlsEnabled,
    tlsServerName,
  }
}

export function getTemporalRuntimeConfig(
  env: RuntimeEnvironment = process.env,
): TemporalRuntimeConfig {
  return readTemporalConnectionConfig(env)
}

export function getTemporalWorkerRuntimeConfig(
  env: RuntimeEnvironment = process.env,
): TemporalWorkerRuntimeConfig {
  const runtime = getTemporalRuntimeConfig(env)
  return {
    ...runtime,
    workerDeploymentName:
      readOptionalString(env, 'TEMPORAL_WORKER_DEPLOYMENT_NAME') ??
      (isProductionRuntime(env)
        ? readRequiredString(env, 'TEMPORAL_WORKER_DEPLOYMENT_NAME')
        : 'waoowaoo'),
    workerBuildId: readWorkerBuildId(env, isProductionRuntime(env) ? null : 'local'),
    workerVersioningEnabled: readWorkerVersioningEnabled(env),
    workerReadyFile: readOptionalString(env, 'TEMPORAL_WORKER_READY_FILE'),
  }
}

export function buildTemporalConnectionOptions(config: TemporalRuntimeConfig): {
  address: string
  apiKey?: string
  tls: false | true | { serverNameOverride: string }
} {
  return {
    address: config.address,
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    tls: config.tlsEnabled
      ? config.tlsServerName
        ? { serverNameOverride: config.tlsServerName }
        : true
      : false,
  }
}
