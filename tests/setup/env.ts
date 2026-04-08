import fs from 'node:fs'
import path from 'node:path'

let loaded = false

function resolveEnvPaths() {
  return [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '.env.test'),
  ]
}

function parseEnvLine(line: string) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  const idx = trimmed.indexOf('=')
  if (idx <= 0) return null
  const key = trimmed.slice(0, idx).trim()
  if (!key) return null
  const rawValue = trimmed.slice(idx + 1).trim()
  const unquoted =
    (rawValue.startsWith('"') && rawValue.endsWith('"'))
    || (rawValue.startsWith("'") && rawValue.endsWith("'"))
      ? rawValue.slice(1, -1)
      : rawValue
  return { key, value: unquoted }
}

function deriveTestDatabaseUrl(databaseUrl: string) {
  try {
    const parsed = new URL(databaseUrl)
    const databaseName = parsed.pathname.replace(/^\//, '').trim()
    const nextDatabaseName = databaseName.endsWith('_test')
      ? databaseName
      : `${databaseName || 'waoowaoo'}_test`
    parsed.pathname = `/${nextDatabaseName}`
    return parsed.toString()
  } catch {
    return databaseUrl
  }
}

export function loadTestEnv() {
  if (loaded) return
  loaded = true
  const mutableEnv = process.env as Record<string, string | undefined>
  const setIfMissing = (key: string, value: string) => {
    if (!mutableEnv[key]) {
      mutableEnv[key] = value
    }
  }

  for (const envPath of resolveEnvPaths()) {
    if (!fs.existsSync(envPath)) continue
    const content = fs.readFileSync(envPath, 'utf8')
    for (const line of content.split('\n')) {
      const pair = parseEnvLine(line)
      if (!pair) continue
      if (mutableEnv[pair.key] === undefined) {
        mutableEnv[pair.key] = pair.value
      }
    }
  }

  setIfMissing('NODE_ENV', 'test')
  setIfMissing('BILLING_MODE', 'OFF')
  const baseDatabaseUrl = mutableEnv.DATABASE_URL || 'mysql://root:waoowaoo123@127.0.0.1:13306/waoowaoo'
  mutableEnv.DATABASE_URL = deriveTestDatabaseUrl(baseDatabaseUrl)
  setIfMissing('REDIS_HOST', '127.0.0.1')
  setIfMissing('REDIS_PORT', '16379')
}

loadTestEnv()

if (process.env.ALLOW_TEST_NETWORK !== '1' && typeof globalThis.fetch === 'function') {
  const originalFetch = globalThis.fetch
  const allowHosts = new Set(['localhost', '127.0.0.1'])

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    const parsed = new URL(rawUrl, 'http://localhost')
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      if (!allowHosts.has(parsed.hostname)) {
        throw new Error(`Network blocked in tests: ${parsed.hostname}`)
      }
    }
    return await originalFetch(input, init)
  }) as typeof fetch
}
