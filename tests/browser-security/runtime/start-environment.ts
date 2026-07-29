import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
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

const RUNTIME_IDENTITY = resolveSecurityRuntimeIdentity()
const APP_PORT = RUNTIME_IDENTITY.appPort
const ARTIFACT_ROOT = resolveSecurityArtifactRoot()
const ORACLE_DATABASE_USER = 'security_oracle'
let startupScope: Required<TestServiceScope> | null = null

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
    BILLING_MODE: 'OFF',
    DEPLOYMENT_EDITION: 'self-hosted',
    PROVIDER_CREDENTIAL_MODE: 'platform-key',
    DATABASE_URL: testServices.databaseUrl,
    REDIS_HOST: testServices.redisHost,
    REDIS_PORT: String(testServices.redisPort),
    STORAGE_TYPE: 'local',
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

function spawnNext(env: NodeJS.ProcessEnv): ChildProcess {
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
  return child
}

function signalChild(child: ChildProcess, signal: NodeJS.Signals): void {
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

async function main(): Promise<void> {
  await mkdir(ARTIFACT_ROOT, { recursive: true })
  await writeTypeScriptConfig()
  const scope = createScope()
  startupScope = scope
  const services = await prepareFreshTestServices(scope, {
    mysqlMaxAttempts: 30,
    mysqlConnectTimeoutMs: 1_000,
    redisMaxAttempts: 30,
  })
  const env = applicationEnvironment(services)
  const oracleDatabaseUrl = await createReadOnlyOracle(services.databaseUrl, randomUUID())
  await writeFile(path.join(ARTIFACT_ROOT, 'environment.json'), JSON.stringify({
    runtimeId: RUNTIME_IDENTITY.runtimeId,
    appBaseUrl: `http://127.0.0.1:${String(APP_PORT)}`,
    oracleDatabaseUrl,
    testServiceScope: scope.composeProjectName,
  }, null, 2))

  const child = spawnNext(env)
  let stopping = false
  const stop = async (): Promise<void> => {
    if (stopping) return
    stopping = true
    signalChild(child, 'SIGTERM')
    stopTestServices(scope)
    await rm(path.resolve(process.cwd(), RUNTIME_IDENTITY.tsconfigPath), { force: true })
    process.exit(0)
  }
  process.on('SIGINT', () => void stop())
  process.on('SIGTERM', () => void stop())
  await waitForApplication(child)
  await new Promise<void>(() => undefined)
}

main().catch(async (error: unknown) => {
  console.error(error)
  if (startupScope) stopTestServices(startupScope)
  await rm(path.resolve(process.cwd(), RUNTIME_IDENTITY.tsconfigPath), { force: true })
  process.exit(1)
})
