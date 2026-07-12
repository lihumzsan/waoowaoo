import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import mysql from 'mysql2/promise'
import Redis from 'ioredis'
import { loadTestEnv } from './env'

type DbConfig = {
  host: string
  port: number
  user: string
  password: string
  database: string
}

export interface TestServiceScope {
  readonly composeProjectName?: string
}

export interface TestServiceEndpoints {
  readonly scope: Required<TestServiceScope>
  readonly databaseUrl: string
  readonly redisHost: string
  readonly redisPort: number
}

export interface TestServiceReadinessOptions {
  readonly mysqlMaxAttempts?: number
  readonly mysqlConnectTimeoutMs?: number
  readonly redisMaxAttempts?: number
}

function parseDbUrl(dbUrl: string): DbConfig {
  const url = new URL(dbUrl)
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
  }
}

function defaultComposeProjectName(): string {
  const worktreeIdentity = createHash('sha256')
    .update(process.cwd())
    .digest('hex')
    .slice(0, 10)
  return `waoowaoo-test-${worktreeIdentity}`
}

function resolveScope(scope?: TestServiceScope): Required<TestServiceScope> {
  return {
    composeProjectName: scope?.composeProjectName?.trim() || defaultComposeProjectName(),
  }
}

function composeArgs(scope: Required<TestServiceScope>, args: readonly string[]): string[] {
  return [
    'compose',
    '-p', scope.composeProjectName,
    '-f', 'docker-compose.test.yml',
    ...args,
  ]
}

function runCompose(scope: Required<TestServiceScope>, args: readonly string[]): void {
  execFileSync('docker', composeArgs(scope, args), {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TEST_MYSQL_PORT: '0',
      TEST_REDIS_PORT: '0',
    },
    stdio: 'inherit',
  })
}

function readPublishedPort(
  scope: Required<TestServiceScope>,
  service: 'mysql' | 'redis',
  containerPort: 3306 | 6379,
): number {
  const output = execFileSync('docker', composeArgs(scope, ['port', service, String(containerPort)]), {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TEST_MYSQL_PORT: '0',
      TEST_REDIS_PORT: '0',
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim().split('\n')[0]
  const match = output?.match(/:(\d+)$/)
  if (!match) throw new Error(`TEST_SERVICE_PORT_UNRESOLVED:${service}:${output ?? ''}`)
  const port = Number(match[1])
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`TEST_SERVICE_PORT_INVALID:${service}:${match[1]}`)
  }
  return port
}

function applyEndpoints(endpoints: TestServiceEndpoints): void {
  process.env.DATABASE_URL = endpoints.databaseUrl
  process.env.REDIS_HOST = endpoints.redisHost
  process.env.REDIS_PORT = String(endpoints.redisPort)
}

function readEndpoints(scope?: TestServiceScope): TestServiceEndpoints {
  loadTestEnv()
  const resolvedScope = resolveScope(scope)
  const mysqlPort = readPublishedPort(resolvedScope, 'mysql', 3306)
  const redisPort = readPublishedPort(resolvedScope, 'redis', 6379)
  const configuredDatabaseUrl = process.env.DATABASE_URL?.trim()
  if (!configuredDatabaseUrl) throw new Error('TEST_DATABASE_URL_REQUIRED')
  const databaseUrl = new URL(configuredDatabaseUrl)
  databaseUrl.hostname = '127.0.0.1'
  databaseUrl.port = String(mysqlPort)
  const endpoints = {
    scope: resolvedScope,
    databaseUrl: databaseUrl.toString(),
    redisHost: '127.0.0.1',
    redisPort,
  }
  applyEndpoints(endpoints)
  return endpoints
}

export async function waitForMysql(maxAttempts = 180, connectTimeoutMs = 5_000) {
  const db = parseDbUrl(process.env.DATABASE_URL || '')

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const conn = await mysql.createConnection({
        host: db.host,
        port: db.port,
        user: db.user,
        password: db.password,
        database: db.database,
        connectTimeout: connectTimeoutMs,
      })
      await conn.query('SELECT 1')
      await conn.end()
      return
    } catch (error) {
      if (attempt === 1 || attempt % 10 === 0) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[test-services] MySQL readiness attempt ${String(attempt)} failed: ${message}`)
      }
      await sleep(1_000)
    }
  }

  throw new Error('MySQL test service did not become ready in time')
}

export async function waitForRedis(maxAttempts = 60) {
  const redis = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || '6380'),
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  })

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        if (redis.status !== 'ready') {
          await redis.connect()
        }
        const pong = await redis.ping()
        if (pong === 'PONG') return
      } catch (error) {
        if (attempt === 1 || attempt % 10 === 0) {
          const message = error instanceof Error ? error.message : String(error)
          console.warn(`[test-services] Redis readiness attempt ${String(attempt)} failed: ${message}`)
        }
        await sleep(1_000)
      }
    }
  } finally {
    redis.disconnect()
  }

  throw new Error('Redis test service did not become ready in time')
}

export function startTestServices(scope?: TestServiceScope): TestServiceEndpoints {
  loadTestEnv()
  const resolvedScope = resolveScope(scope)
  runCompose(resolvedScope, ['up', '-d', '--remove-orphans'])
  return readEndpoints(resolvedScope)
}

export function stopTestServices(scope?: TestServiceScope): void {
  loadTestEnv()
  runCompose(resolveScope(scope), ['down', '-v', '--remove-orphans'])
}

export async function waitForTestServices(
  scope?: TestServiceScope,
  options: TestServiceReadinessOptions = {},
): Promise<TestServiceEndpoints> {
  const endpoints = readEndpoints(scope)
  await waitForMysql(options.mysqlMaxAttempts, options.mysqlConnectTimeoutMs)
  await waitForRedis(options.redisMaxAttempts)
  return endpoints
}

export function pushTestSchema(scope?: TestServiceScope): TestServiceEndpoints {
  const endpoints = readEndpoints(scope)
  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--schema', 'prisma/schema.prisma'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  })
  return endpoints
}

export async function prepareFreshTestServices(
  scope?: TestServiceScope,
  options: TestServiceReadinessOptions = {},
): Promise<TestServiceEndpoints> {
  stopTestServices(scope)
  startTestServices(scope)
  await waitForTestServices(scope, options)
  return pushTestSchema(scope)
}
