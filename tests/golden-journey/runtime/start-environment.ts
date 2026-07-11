import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import mysql from 'mysql2/promise'
import { prepareFreshTestServices } from '../../setup/test-services'
import { startGoldenProviderGateway, type GoldenProviderGateway } from '../providers/gateway'
import { startGoldenMediaServer, type GoldenMediaServer } from '../providers/media/server'
import { startGoldenModelServer, type GoldenModelServer } from '../providers/model/server'

const APP_PORT = 3100
const COORDINATOR_PORT = 3199
const ARTIFACT_ROOT = path.resolve(process.cwd(), 'artifacts/golden-journey')
const ORACLE_DATABASE_URL = 'mysql://golden_oracle:golden_oracle_password@127.0.0.1:3307/waoowaoo_test'

interface GoldenEnvironmentState {
  readonly model: GoldenModelServer
  readonly media: GoldenMediaServer
  readonly gateway: GoldenProviderGateway
  readonly children: readonly ChildProcess[]
  readonly coordinator: Server
}

function executable(name: string): string {
  return path.resolve(process.cwd(), 'node_modules/.bin', name)
}

function baseEnvironment(gatewayBaseUrl: string): NodeJS.ProcessEnv {
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
    PROVIDER_CREDENTIAL_MODE: 'platform-key',
    DATABASE_URL: 'mysql://root:root@127.0.0.1:3307/waoowaoo_test',
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: '6380',
    STORAGE_TYPE: 'local',
    NEXTAUTH_URL: `http://127.0.0.1:${APP_PORT}`,
    NEXTAUTH_SECRET: 'golden-journey-nextauth-secret',
    GOOGLE_CLIENT_ID: 'golden-journey-google-client-id',
    GOOGLE_CLIENT_SECRET: 'golden-journey-google-client-secret',
    INTERNAL_APP_URL: `http://127.0.0.1:${APP_PORT}`,
    INTERNAL_TASK_TOKEN: 'golden-journey-internal-task-token',
    CRON_SECRET: 'golden-journey-cron-secret',
    API_ENCRYPTION_KEY: 'golden-journey-fixed-encryption-key',
    PLATFORM_OPENROUTER_API_KEY: `golden-scenario:${process.env.GOLDEN_MODEL_SCENARIO ?? 'normal-mainline'}`,
    PLATFORM_OPENROUTER_BASE_URL: `${gatewayBaseUrl}/v1`,
    PLATFORM_FAL_API_KEY: 'golden-fal-key',
    FAL_QUEUE_BASE_URL: gatewayBaseUrl,
    PLATFORM_ELEVENLABS_API_KEY: 'golden-elevenlabs-key',
    PLATFORM_ELEVENLABS_BASE_URL: gatewayBaseUrl,
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

async function createReadOnlyOracleUser(): Promise<void> {
  const connection = await mysql.createConnection('mysql://root:root@127.0.0.1:3307/waoowaoo_test')
  try {
    await connection.query("CREATE USER IF NOT EXISTS 'golden_oracle'@'%' IDENTIFIED BY 'golden_oracle_password'")
    await connection.query("GRANT SELECT ON `waoowaoo_test`.* TO 'golden_oracle'@'%'")
  } finally {
    await connection.end()
  }
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
  })
  child.stdout?.pipe(log)
  child.stderr?.pipe(log)
  child.once('exit', (code, signal) => {
    log.write(`\n[golden-environment] ${input.name} exited code=${String(code)} signal=${String(signal)}\n`)
  })
  return child
}

async function waitForApp(children: readonly ChildProcess[]): Promise<void> {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const deadChild = children.find((child) => child.exitCode !== null)
    if (deadChild) throw new Error(`GOLDEN_ENVIRONMENT_CHILD_EXITED:${String(deadChild.exitCode)}`)
    try {
      const response = await fetch(`http://127.0.0.1:${APP_PORT}/api/system/boot-id`)
      if (response.ok) return
    } catch {
      // The app is still booting.
    }
    await delay(500)
  }
  throw new Error('GOLDEN_APP_START_TIMEOUT')
}

async function startCoordinator(children: readonly ChildProcess[]): Promise<Server> {
  const server = createServer((_request, response) => {
    const exited = children.filter((child) => child.exitCode !== null)
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

async function startEnvironment(): Promise<GoldenEnvironmentState> {
  await mkdir(ARTIFACT_ROOT, { recursive: true })
  await prepareFreshTestServices()
  const model = await startGoldenModelServer()
  const media = await startGoldenMediaServer()
  const gateway = await startGoldenProviderGateway({
    modelBaseUrl: model.baseUrl.replace(/\/v1$/, ''),
    mediaBaseUrl: media.baseUrl,
  })
  const env = baseEnvironment(gateway.baseUrl)
  runSetup(executable('tsx'), ['src/lib/storage/init.ts'], env)
  await createReadOnlyOracleUser()
  const children = [
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
  ]
  await waitForApp(children)
  const coordinator = await startCoordinator(children)
  await writeFile(path.join(ARTIFACT_ROOT, 'environment.json'), JSON.stringify({
    appBaseUrl: `http://127.0.0.1:${APP_PORT}`,
    providerBaseUrl: gateway.baseUrl,
    databaseUrl: env.DATABASE_URL,
    oracleDatabaseUrl: ORACLE_DATABASE_URL,
    redisHost: env.REDIS_HOST,
    redisPort: env.REDIS_PORT,
    gitCommit: process.env.GOLDEN_GIT_COMMIT ?? 'fb7d2fa42121409a469c3adaaaefa0f64b2c1ba6',
  }, null, 2))
  return { model, media, gateway, children, coordinator }
}

async function stopEnvironment(state: GoldenEnvironmentState): Promise<void> {
  for (const child of state.children) child.kill('SIGTERM')
  await Promise.allSettled([
    ...state.children.map(async (child) => await new Promise<void>((resolve) => {
      if (child.exitCode !== null) return resolve()
      child.once('exit', () => resolve())
      setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, 5_000).unref()
    })),
    new Promise<void>((resolve) => state.coordinator.close(() => resolve())),
    state.gateway.close(),
    state.model.close(),
    state.media.close(),
  ])
}

async function main(): Promise<void> {
  const state = await startEnvironment()
  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    await stopEnvironment(state)
    process.exit(0)
  }
  process.on('SIGINT', () => void stop())
  process.on('SIGTERM', () => void stop())
  await new Promise<void>(() => undefined)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
