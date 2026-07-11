import { resolvePositiveIntegerConfig } from '@/lib/runtime-config/positive-integer'

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>

function resolveOptionalText(
  name: string,
  value: string | undefined,
  options?: { readonly emptyMeansMissing?: boolean },
): string | undefined {
  if (value === undefined) return undefined
  const normalized = value.trim()
  if (!normalized && options?.emptyMeansMissing) return undefined
  if (!normalized) throw new Error(`TEXT_CONFIG_INVALID:${name}`)
  return normalized
}

function resolveRedisTls(value: string | undefined): boolean {
  if (value === undefined || value.trim() === '') return false
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`BOOLEAN_CONFIG_INVALID:REDIS_TLS:${value}`)
}

function resolveOptionalCredential(value: string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined
  return value
}

export function resolveRedisRuntimeConfig(env: RuntimeEnvironment = process.env) {
  const configuredHost = resolveOptionalText('REDIS_HOST', env.REDIS_HOST)
  return {
    host: configuredHost ?? '127.0.0.1',
    port: resolvePositiveIntegerConfig({
      name: 'REDIS_PORT',
      value: env.REDIS_PORT,
      defaultValue: 6_379,
      maxValue: 65_535,
    }),
    username: resolveOptionalText('REDIS_USERNAME', env.REDIS_USERNAME, { emptyMeansMissing: true }),
    password: resolveOptionalCredential(env.REDIS_PASSWORD),
    tls: resolveRedisTls(env.REDIS_TLS),
  }
}
