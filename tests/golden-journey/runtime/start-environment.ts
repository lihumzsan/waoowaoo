import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import mysql from 'mysql2/promise'
import {
  prepareFreshTestServices,
  stopTestServices,
  type TestServiceEndpoints,
  type TestServiceScope,
} from '../../setup/test-services'
import { startGoldenProviderGateway, type GoldenProviderGateway } from '../providers/gateway'
import { startGoldenMediaServer, type GoldenMediaServer } from '../providers/media/server'
import { startGoldenModelServer, type GoldenModelServer } from '../providers/model/server'
import { resolveGoldenArtifactRoot, resolveGoldenRuntimeIdentity } from './identity'

const RUNTIME_IDENTITY = resolveGoldenRuntimeIdentity()
const APP_PORT = RUNTIME_IDENTITY.appPort
const COORDINATOR_PORT = RUNTIME_IDENTITY.coordinatorPort
const ARTIFACT_ROOT = resolveGoldenArtifactRoot()
const ORACLE_DATABASE_USER = 'golden_oracle'
let startupServiceScope: Required<TestServiceScope> | null = null

interface GoldenEnvironmentState {
  readonly model: GoldenModelServer
  readonly media: GoldenMediaServer
  readonly gateway: GoldenProviderGateway
  readonly children: readonly ChildProcess[]
  readonly coordinator: Server
  readonly testServices: TestServiceEndpoints
}

function createGoldenTestServiceScope(): Required<TestServiceScope> {
  return {
    composeProjectName: `waoowaoo-golden-${randomUUID().replaceAll('-', '').slice(0, 12)}`,
  }
}

function executable(name: string): string {
  return path.resolve(process.cwd(), 'node_modules/.bin', name)
}

function baseEnvironment(
  gatewayBaseUrl: string,
  testServices: TestServiceEndpoints,
): NodeJS.ProcessEnv {
  const networkGuard = path.resolve(
    process.cwd(),
    'tests/golden-journey/runtime/network-guard.mjs',
  )
  return {
    ...process.env,
    NODE_ENV: 'development',
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${networkGuard}`.trim(),
    BILLING_MODE: 'OFF',
    DEPLOYMENT_EDITION: 'self-hosted',
    PROVIDER_CREDENTIAL_MODE: process.env.GOLDEN_PROVIDER_CREDENTIAL_MODE ?? 'platform-key',
    DATABASE_URL: testServices.databaseUrl,
    REDIS_HOST: testServices.redisHost,
    REDIS_PORT: String(testServices.redisPort),
    STORAGE_TYPE: 'local',
    UPLOAD_DIR: RUNTIME_IDENTITY.uploadDir,
    NEXT_DIST_DIR: RUNTIME_IDENTITY.distDir,
    NEXT_TSCONFIG_PATH: RUNTIME_IDENTITY.tsconfigPath,
    NEXTAUTH_URL: `http://127.0.0.1:${APP_PORT}`,
    NEXTAUTH_SECRET: 'golden-journey-nextauth-secret',
    TRUSTED_PROXY_HOPS: '1',
    GOOGLE_CLIENT_ID: 'golden-journey-google-client-id',
    GOOGLE_CLIENT_SECRET: 'golden-journey-google-client-secret',
    INTERNAL_APP_URL: `http://127.0.0.1:${APP_PORT}`,
    CRON_SECRET: 'golden-journey-cron-secret',
    API_ENCRYPTION_KEY: 'golden-journey-fixed-encryption-key',
    PLATFORM_OPENROUTER_API_KEY: `golden-scenario:${process.env.GOLDEN_MODEL_SCENARIO ?? 'free-composition'}`,
    PLATFORM_OPENROUTER_BASE_URL: `${gatewayBaseUrl}/v1`,
    PLATFORM_FAL_API_KEY: 'golden-fal-key',
    FAL_QUEUE_BASE_URL: gatewayBaseUrl,
    OUTBOX_DISPATCH_INTERVAL_MS: '1000',
    WORKER_EXTERNAL_POLL_MS: '50',
    TASK_RECONCILE_INTERVAL_MS: '1000',
    LOG_LEVEL: 'INFO',
    LOG_FORMAT: 'json',
    LOG_UNIFIED_ENABLED: 'true',
    LOG_AUDIT_ENABLED: 'true',
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
  }
}

async function writeGoldenTypeScriptConfig(): Promise<void> {
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

async function removeGoldenTypeScriptConfig(): Promise<void> {
  await rm(path.resolve(process.cwd(), RUNTIME_IDENTITY.tsconfigPath), { force: true })
}

function runSetup(command: string, args: readonly string[], env: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, [...args], {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    throw new Error(`GOLDEN_ENVIRONMENT_SETUP_FAILED:${command}:${String(result.status)}`)
  }
}

function buildOracleDatabaseUrl(databaseUrl: string, password: string): string {
  const url = new URL(databaseUrl)
  url.username = ORACLE_DATABASE_USER
  url.password = password
  return url.toString()
}

async function createReadOnlyOracleUser(databaseUrl: string, password: string): Promise<string> {
  const connection = await mysql.createConnection(databaseUrl)
  try {
    await connection.query(
      `CREATE USER IF NOT EXISTS '${ORACLE_DATABASE_USER}'@'%' IDENTIFIED BY ${connection.escape(password)}`,
    )
    await connection.query("GRANT SELECT ON `waoowaoo_test`.* TO 'golden_oracle'@'%'")
  } finally {
    await connection.end()
  }
  return buildOracleDatabaseUrl(databaseUrl, password)
}

function spawnLogged(input: {
  readonly name: string
  readonly command: string
  readonly args: readonly string[]
  readonly env: NodeJS.ProcessEnv
}): ChildProcess {
  const log = createWriteStream(path.join(ARTIFACT_ROOT, `${input.name}.log`), { flags: 'a' })
  const child = spawn(input.command, [...input.args], {
    cwd: process.cwd(),
    env: input.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })
  child.stdout?.pipe(log)
  child.stderr?.pipe(log)
  child.once('exit', (code, signal) => {
    log.write(`\n[golden-environment] ${input.name} exited code=${String(code)} signal=${String(signal)}\n`)
  })
  return child
}

function signalChildTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid || child.exitCode !== null) return
  try {
    if (process.platform === 'win32') child.kill(signal)
    else process.kill(-child.pid, signal)
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code: unknown }).code)
      : ''
    if (code !== 'ESRCH') throw error
  }
}

async function waitForApp(children: readonly ChildProcess[]): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const deadChild = children.find((child) => child.exitCode !== null)
    if (deadChild) throw new Error(`GOLDEN_ENVIRONMENT_CHILD_EXITED:${String(deadChild.exitCode)}`)
    try {
      const response = await fetch(`http://127.0.0.1:${APP_PORT}/api/system/boot-id`, {
        signal: AbortSignal.timeout(2_000),
      })
      if (response.ok) return
    } catch {
      // The app is still booting.
    }
    await delay(500)
  }
  throw new Error('GOLDEN_APP_START_TIMEOUT')
}

async function startCoordinator(input: {
  readonly children: readonly ChildProcess[]
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
    const exited = input.children.filter((child) => child.exitCode !== null)
    const healthy = exited.length === 0
    response.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      ok: healthy,
      exited: exited.map((child) => child.exitCode),
    }))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(COORDINATOR_PORT, '127.0.0.1', () => resolve())
  })
  return server
}

async function startEnvironment(onShutdown: () => void): Promise<GoldenEnvironmentState> {
  await mkdir(ARTIFACT_ROOT, { recursive: true })
  await writeGoldenTypeScriptConfig()
  const serviceScope = createGoldenTestServiceScope()
  const shutdownToken = randomUUID()
  startupServiceScope = serviceScope
  await writeFile(path.join(ARTIFACT_ROOT, 'environment.json'), JSON.stringify({
    runtimeId: RUNTIME_IDENTITY.runtimeId,
    ownerPid: process.pid,
    status: 'starting',
    appBaseUrl: `http://127.0.0.1:${APP_PORT}`,
    coordinatorBaseUrl: `http://127.0.0.1:${COORDINATOR_PORT}`,
    shutdownToken,
    testServiceScope: serviceScope.composeProjectName,
  }, null, 2))
  console.log(`[golden-environment] runtime=${RUNTIME_IDENTITY.runtimeId} appPort=${String(APP_PORT)} coordinatorPort=${String(COORDINATOR_PORT)} scope=${serviceScope.composeProjectName}`)
  let testServices: TestServiceEndpoints | null = null
  let model: GoldenModelServer | null = null
  let media: GoldenMediaServer | null = null
  let gateway: GoldenProviderGateway | null = null
  const children: ChildProcess[] = []
  let coordinator: Server | null = null
  try {
    console.log('[golden-environment] preparing scoped MySQL and Redis')
    testServices = await prepareFreshTestServices(serviceScope, {
      mysqlMaxAttempts: 15,
      mysqlConnectTimeoutMs: 1_000,
      redisMaxAttempts: 15,
    })
    console.log(`[golden-environment] services ready mysql=${new URL(testServices.databaseUrl).port} redis=${String(testServices.redisPort)}`)
    model = await startGoldenModelServer()
    media = await startGoldenMediaServer()
    gateway = await startGoldenProviderGateway({
      modelBaseUrl: model.baseUrl.replace(/\/v1$/, ''),
      mediaBaseUrl: media.baseUrl,
    })
    const env = baseEnvironment(gateway.baseUrl, testServices)
    runSetup(executable('tsx'), ['src/lib/storage/init.ts'], env)
    const oracleDatabaseUrl = await createReadOnlyOracleUser(testServices.databaseUrl, randomUUID())
    children.push(
      spawnLogged({
        name: 'next',
        command: executable('next'),
        args: ['dev', '--turbopack', '-H', '127.0.0.1', '-p', String(APP_PORT)],
        env,
      }),
      spawnLogged({
        name: 'worker',
        command: executable('tsx'),
        args: ['src/lib/workers/index.ts'],
        env,
      }),
    )
    await waitForApp(children)
    await writeFile(path.join(ARTIFACT_ROOT, 'environment.json'), JSON.stringify({
      runtimeId: RUNTIME_IDENTITY.runtimeId,
      ownerPid: process.pid,
      status: 'ready',
      appBaseUrl: `http://127.0.0.1:${APP_PORT}`,
      coordinatorBaseUrl: `http://127.0.0.1:${COORDINATOR_PORT}`,
      shutdownToken,
      providerBaseUrl: gateway.baseUrl,
      databaseUrl: env.DATABASE_URL,
      oracleDatabaseUrl,
      redisHost: env.REDIS_HOST,
      redisPort: env.REDIS_PORT,
      testServiceScope: testServices.scope.composeProjectName,
      gitCommit: process.env.GOLDEN_GIT_COMMIT ?? 'fb7d2fa42121409a469c3adaaaefa0f64b2c1ba6',
    }, null, 2))
    coordinator = await startCoordinator({ children, shutdownToken, onShutdown })
    return { model, media, gateway, children, coordinator, testServices }
  } catch (error) {
    for (const child of children) signalChildTree(child, 'SIGTERM')
    if (coordinator) await new Promise<void>((resolve) => coordinator?.close(() => resolve()))
    await Promise.allSettled([
      gateway?.close(),
      model?.close(),
      media?.close(),
    ].filter((candidate): candidate is Promise<void> => candidate !== undefined))
    stopTestServices(testServices?.scope ?? serviceScope)
    await removeGoldenTypeScriptConfig()
    throw error
  }
}

async function stopEnvironment(state: GoldenEnvironmentState): Promise<void> {
  for (const child of state.children) signalChildTree(child, 'SIGTERM')
  await Promise.allSettled([
    ...state.children.map(async (child) => await new Promise<void>((resolve) => {
      if (child.exitCode !== null) return resolve()
      child.once('exit', () => resolve())
      setTimeout(() => {
        signalChildTree(child, 'SIGKILL')
        resolve()
      }, 5_000).unref()
    })),
    state.gateway.close(),
    state.model.close(),
    state.media.close(),
  ])
  stopTestServices(state.testServices.scope)
  await new Promise<void>((resolve) => state.coordinator.close(() => resolve()))
  await removeGoldenTypeScriptConfig()
}

async function main(): Promise<void> {
  let state: GoldenEnvironmentState | null = null
  let stopRequested = false
  let stopping = false
  const stop = async () => {
    if (!state) {
      stopRequested = true
      if (startupServiceScope) stopTestServices(startupServiceScope)
      process.exit(0)
      return
    }
    if (stopping) return
    stopping = true
    await stopEnvironment(state)
    process.exit(0)
  }
  process.on('SIGINT', () => void stop())
  process.on('SIGTERM', () => void stop())
  state = await startEnvironment(() => void stop())
  if (stopRequested) await stop()
  await new Promise<void>(() => undefined)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
