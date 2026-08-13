import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createWriteStream, type WriteStream } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import mysql from 'mysql2/promise'
import {
  prepareFreshTestServices,
  stopTestServices,
  type TestServiceEndpoints,
  type TestServiceScope,
} from '../../setup/test-services'
import { resolveSecurityArtifactRoot, resolveSecurityRuntimeIdentity } from './identity'
import {
  createSecurityProcessIdentity,
  terminateSecurityProcessTree,
  type SecurityProcessIdentity,
} from './process-lifecycle'

const RUNTIME_IDENTITY = resolveSecurityRuntimeIdentity()
const APP_PORT = RUNTIME_IDENTITY.appPort
const COORDINATOR_PORT = RUNTIME_IDENTITY.coordinatorPort
const ARTIFACT_ROOT = resolveSecurityArtifactRoot()
const ORACLE_DATABASE_USER = 'security_oracle'

interface SecurityEnvironmentDescriptor {
  readonly runtimeId: string
  readonly ownerPid: number
  readonly status: 'starting' | 'ready'
  readonly appBaseUrl: string
  readonly coordinatorBaseUrl: string
  readonly shutdownToken: string
  readonly testServiceScope: string
  readonly tsconfigPath: string
  readonly appProcess?: SecurityProcessIdentity
  readonly oracleDatabaseUrl?: string
}

interface OwnedNextProcess {
  readonly child: ChildProcess
  readonly identity: SecurityProcessIdentity
  readonly log: WriteStream
}

interface OwnedEnvironment {
  scope: Required<TestServiceScope> | null
  coordinator: Server | null
  next: OwnedNextProcess | null
}

const ownedEnvironment: OwnedEnvironment = {
  scope: null,
  coordinator: null,
  next: null,
}
let shutdownPromise: Promise<void> | null = null

function executable(name: string): string {
  return path.resolve(process.cwd(), 'node_modules/.bin', name)
}

function createScope(): Required<TestServiceScope> {
  return {
    composeProjectName: `waoowaoo-security-${randomUUID().replaceAll('-', '').slice(0, 12)}`,
  }
}

function applicationEnvironment(testServices: TestServiceEndpoints): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: 'development',
    DEPLOYMENT_EDITION: 'self-hosted',
    PROVIDER_CREDENTIAL_MODE: 'platform-key',
    DATABASE_URL: testServices.databaseUrl,
    REDIS_HOST: testServices.redisHost,
    REDIS_PORT: String(testServices.redisPort),
    UPLOAD_DIR: RUNTIME_IDENTITY.uploadDir,
    NEXT_DIST_DIR: RUNTIME_IDENTITY.distDir,
    NEXT_TSCONFIG_PATH: RUNTIME_IDENTITY.tsconfigPath,
    NEXTAUTH_URL: `http://127.0.0.1:${String(APP_PORT)}`,
    NEXTAUTH_SECRET: 'browser-security-nextauth-secret',
    TRUSTED_PROXY_HOPS: '1',
    GOOGLE_CLIENT_ID: 'browser-security-google-client-id',
    GOOGLE_CLIENT_SECRET: 'browser-security-google-client-secret',
    INTERNAL_APP_URL: `http://127.0.0.1:${String(APP_PORT)}`,
    CRON_SECRET: 'browser-security-cron-secret',
    API_ENCRYPTION_KEY: 'browser-security-fixed-encryption-key',
    PLATFORM_OPENROUTER_API_KEY: 'browser-security-unused-key',
    PLATFORM_OPENROUTER_BASE_URL: 'http://127.0.0.1:9/v1',
    PLATFORM_FAL_API_KEY: 'browser-security-unused-key',
    FAL_QUEUE_BASE_URL: 'http://127.0.0.1:9',
    PLATFORM_DEFAULT_ANALYSIS_MODEL: 'openrouter::openai/gpt-5.6-luna',
    PLATFORM_DEFAULT_CHARACTER_MODEL: 'openrouter::openai/gpt-image-2',
    PLATFORM_DEFAULT_LOCATION_MODEL: 'openrouter::openai/gpt-image-2',
    PLATFORM_DEFAULT_EDIT_MODEL: 'openrouter::openai/gpt-image-2',
    PLATFORM_DEFAULT_VIDEO_MODEL: 'toonflow::seedance-2.0',
    PLATFORM_DEFAULT_MUSIC_MODEL: 'elevenlabs::music_v2',
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
  }
}

async function writeTypeScriptConfig(): Promise<void> {
  await writeFile(
    path.resolve(process.cwd(), RUNTIME_IDENTITY.tsconfigPath),
    `${JSON.stringify({
      extends: './tsconfig.json',
      compilerOptions: {
        incremental: true,
        tsBuildInfoFile: `${RUNTIME_IDENTITY.distDir}/tsconfig.tsbuildinfo`,
      },
      include: [
        'next-env.d.ts',
        'src/**/*.ts',
        'src/**/*.tsx',
        `${RUNTIME_IDENTITY.distDir}/types/**/*.ts`,
      ],
      exclude: ['node_modules', '.next', 'scripts', 'tmp'],
    }, null, 2)}\n`,
  )
}

async function createReadOnlyOracle(databaseUrl: string, password: string): Promise<string> {
  const connection = await mysql.createConnection(databaseUrl)
  try {
    await connection.query(
      `CREATE USER IF NOT EXISTS '${ORACLE_DATABASE_USER}'@'%' IDENTIFIED BY ${connection.escape(password)}`,
    )
    await connection.query(`GRANT SELECT ON \`waoowaoo_test\`.* TO '${ORACLE_DATABASE_USER}'@'%'`)
  } finally {
    await connection.end()
  }
  const oracleUrl = new URL(databaseUrl)
  oracleUrl.username = ORACLE_DATABASE_USER
  oracleUrl.password = password
  return oracleUrl.toString()
}

function spawnNext(env: NodeJS.ProcessEnv): OwnedNextProcess {
  const log = createWriteStream(path.join(ARTIFACT_ROOT, 'next.log'), { flags: 'a' })
  const child = spawn(
    executable('next'),
    ['dev', '--turbopack', '-H', '127.0.0.1', '-p', String(APP_PORT)],
    {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    },
  )
  child.stdout?.pipe(log)
  child.stderr?.pipe(log)
  if (!child.pid) {
    log.end()
    throw new Error('SECURITY_APPLICATION_PID_MISSING')
  }
  child.once('exit', (code, signal) => {
    log.write(
      `\n[security-environment] next exited code=${String(code)} signal=${String(signal)}\n`,
    )
  })
  return {
    child,
    identity: createSecurityProcessIdentity(child.pid),
    log,
  }
}

async function closeLog(log: WriteStream): Promise<void> {
  if (log.closed) return
  await new Promise<void>((resolve) => {
    log.once('close', resolve)
    log.end()
  })
}

async function waitForApplication(child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`SECURITY_APPLICATION_EXITED:${String(child.exitCode)}`)
    }
    try {
      const response = await fetch(
        `http://127.0.0.1:${String(APP_PORT)}/api/system/boot-id`,
        { signal: AbortSignal.timeout(2_000) },
      )
      if (response.ok) return
    } catch {
      // Application is still booting.
    }
    await delay(500)
  }
  throw new Error('SECURITY_APPLICATION_START_TIMEOUT')
}

async function writeEnvironmentDescriptor(
  descriptor: SecurityEnvironmentDescriptor,
): Promise<void> {
  await writeFile(
    path.join(ARTIFACT_ROOT, 'environment.json'),
    `${JSON.stringify(descriptor, null, 2)}\n`,
  )
}

async function startCoordinator(input: {
  readonly shutdownToken: string
  readonly onShutdown: () => void
}): Promise<Server> {
  const server = createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/shutdown') {
      if (request.headers.authorization !== `Bearer ${input.shutdownToken}`) {
        response.writeHead(403, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ ok: false }))
        return
      }
      response.writeHead(202, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true, runtimeId: RUNTIME_IDENTITY.runtimeId }))
      setImmediate(input.onShutdown)
      return
    }
    const next = ownedEnvironment.next
    const healthy = shutdownPromise === null
      && (next === null || next.child.exitCode === null)
    response.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: healthy }))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(COORDINATOR_PORT, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  return server
}

async function closeCoordinator(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

async function stopOwnedEnvironment(): Promise<void> {
  const cleanupErrors: unknown[] = []
  const next = ownedEnvironment.next
  if (ownedEnvironment.scope) {
    try {
      stopTestServices(ownedEnvironment.scope)
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  try {
    await rm(path.resolve(process.cwd(), RUNTIME_IDENTITY.tsconfigPath), { force: true })
  } catch (error) {
    cleanupErrors.push(error)
  }
  if (ownedEnvironment.coordinator) {
    try {
      await closeCoordinator(ownedEnvironment.coordinator)
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (next) {
    try {
      await terminateSecurityProcessTree(next.identity)
    } catch (error) {
      cleanupErrors.push(error)
    }
    try {
      await closeLog(next.log)
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'SECURITY_ENVIRONMENT_SHUTDOWN_FAILED')
  }
}

async function shutdownAndExit(requestedExitCode: number): Promise<never> {
  shutdownPromise ??= stopOwnedEnvironment()
  let exitCode = requestedExitCode
  try {
    await shutdownPromise
  } catch (error) {
    console.error(error)
    exitCode = 1
  }
  process.exit(exitCode)
}

async function startEnvironment(): Promise<void> {
  await mkdir(ARTIFACT_ROOT, { recursive: true })
  await writeTypeScriptConfig()
  const scope = createScope()
  ownedEnvironment.scope = scope
  const shutdownToken = randomUUID()
  const baseDescriptor: SecurityEnvironmentDescriptor = {
    runtimeId: RUNTIME_IDENTITY.runtimeId,
    ownerPid: process.pid,
    status: 'starting',
    appBaseUrl: `http://127.0.0.1:${String(APP_PORT)}`,
    coordinatorBaseUrl: `http://127.0.0.1:${String(COORDINATOR_PORT)}`,
    shutdownToken,
    testServiceScope: scope.composeProjectName,
    tsconfigPath: RUNTIME_IDENTITY.tsconfigPath,
  }
  await writeEnvironmentDescriptor(baseDescriptor)
  ownedEnvironment.coordinator = await startCoordinator({
    shutdownToken,
    onShutdown: () => {
      void shutdownAndExit(0)
    },
  })
  const services = await prepareFreshTestServices(scope, {
    mysqlMaxAttempts: 30,
    mysqlConnectTimeoutMs: 1_000,
    redisMaxAttempts: 30,
  })
  const env = applicationEnvironment(services)
  const oracleDatabaseUrl = await createReadOnlyOracle(services.databaseUrl, randomUUID())
  const next = spawnNext(env)
  ownedEnvironment.next = next
  await writeEnvironmentDescriptor({
    ...baseDescriptor,
    appProcess: next.identity,
    oracleDatabaseUrl,
  })
  await waitForApplication(next.child)
  await writeEnvironmentDescriptor({
    ...baseDescriptor,
    status: 'ready',
    appProcess: next.identity,
    oracleDatabaseUrl,
  })
}

async function main(): Promise<void> {
  process.once('SIGINT', () => {
    void shutdownAndExit(0)
  })
  process.once('SIGTERM', () => {
    void shutdownAndExit(0)
  })
  await startEnvironment()
  await new Promise<void>(() => undefined)
}

main().catch(async (error: unknown) => {
  console.error(error)
  await shutdownAndExit(1)
})
