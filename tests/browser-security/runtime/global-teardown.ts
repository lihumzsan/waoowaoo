import { readFile } from 'node:fs/promises'
import { rm } from 'node:fs/promises'
import { createConnection } from 'node:net'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { stopTestServices } from '../../setup/test-services'
import { resolveSecurityArtifactRoot } from './identity'
import {
  isSecurityProcessTreeAlive,
  parseSecurityProcessIdentity,
  terminateSecurityProcessTree,
  type SecurityProcessIdentity,
} from './process-lifecycle'

interface SecurityEnvironmentDescriptor {
  readonly testServiceScope?: unknown
  readonly coordinatorBaseUrl?: unknown
  readonly shutdownToken?: unknown
  readonly appBaseUrl?: unknown
  readonly appProcess?: unknown
  readonly tsconfigPath?: unknown
}

interface ValidatedSecurityEnvironmentDescriptor {
  readonly composeProjectName: string
  readonly coordinatorBaseUrl: string | null
  readonly shutdownToken: string | null
  readonly appBaseUrl: string
  readonly appProcess: SecurityProcessIdentity | null
  readonly tsconfigPath: string
}

function readLoopbackUrl(value: unknown, name: string): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`SECURITY_TEARDOWN_${name}_INVALID:${raw || 'missing'}`)
  }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
    throw new Error(`SECURITY_TEARDOWN_${name}_INVALID:${raw}`)
  }
  return url.origin
}

function validateDescriptor(
  descriptor: SecurityEnvironmentDescriptor,
): ValidatedSecurityEnvironmentDescriptor {
  const composeProjectName = typeof descriptor.testServiceScope === 'string'
    ? descriptor.testServiceScope.trim()
    : ''
  if (!composeProjectName.startsWith('waoowaoo-security-')) {
    throw new Error(`SECURITY_TEARDOWN_SCOPE_INVALID:${composeProjectName || 'missing'}`)
  }
  const coordinatorValue = typeof descriptor.coordinatorBaseUrl === 'string'
    ? descriptor.coordinatorBaseUrl.trim()
    : ''
  const tokenValue = typeof descriptor.shutdownToken === 'string'
    ? descriptor.shutdownToken.trim()
    : ''
  if ((coordinatorValue.length > 0) !== (tokenValue.length > 0)) {
    throw new Error('SECURITY_TEARDOWN_COORDINATOR_IDENTITY_PARTIAL')
  }
  const tsconfigPath = typeof descriptor.tsconfigPath === 'string'
    ? descriptor.tsconfigPath.trim()
    : ''
  if (!/^\.tsconfig-security-[A-Za-z0-9_-]+\.json$/.test(tsconfigPath)) {
    throw new Error(`SECURITY_TEARDOWN_TSCONFIG_PATH_INVALID:${tsconfigPath || 'missing'}`)
  }
  return {
    composeProjectName,
    coordinatorBaseUrl: coordinatorValue
      ? readLoopbackUrl(coordinatorValue, 'COORDINATOR_URL')
      : null,
    shutdownToken: tokenValue || null,
    appBaseUrl: readLoopbackUrl(descriptor.appBaseUrl, 'APP_URL'),
    appProcess: parseSecurityProcessIdentity(descriptor.appProcess),
    tsconfigPath,
  }
}

async function isLoopbackPortListening(baseUrl: string): Promise<boolean> {
  const url = new URL(baseUrl)
  const port = Number(url.port)
  return await new Promise<boolean>((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    let settled = false
    const finish = (listening: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(listening)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(500, () => finish(false))
  })
}

async function waitForOwnerShutdown(
  descriptor: ValidatedSecurityEnvironmentDescriptor,
): Promise<boolean> {
  if (!descriptor.coordinatorBaseUrl || !descriptor.shutdownToken) return false
  let response: Response
  try {
    response = await fetch(`${descriptor.coordinatorBaseUrl}/shutdown`, {
      method: 'POST',
      headers: { authorization: `Bearer ${descriptor.shutdownToken}` },
      signal: AbortSignal.timeout(2_000),
    })
  } catch {
    return false
  }
  if (response.status !== 202) {
    throw new Error(`SECURITY_TEARDOWN_SHUTDOWN_HTTP_${String(response.status)}`)
  }
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const [coordinatorAvailable, appAvailable] = await Promise.all([
      isLoopbackPortListening(descriptor.coordinatorBaseUrl),
      isLoopbackPortListening(descriptor.appBaseUrl),
    ])
    const processTreeAlive = descriptor.appProcess
      ? isSecurityProcessTreeAlive(descriptor.appProcess)
      : appAvailable
    if (!coordinatorAvailable && !appAvailable && !processTreeAlive) return true
    await delay(250)
  }
  return false
}

export default async function securityGlobalTeardown(): Promise<void> {
  if (process.env.SECURITY_EXTERNAL_ENV === '1') return
  const descriptorPath = `${resolveSecurityArtifactRoot()}/environment.json`
  let descriptor: SecurityEnvironmentDescriptor
  try {
    descriptor = JSON.parse(await readFile(descriptorPath, 'utf8')) as SecurityEnvironmentDescriptor
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code: unknown }).code)
      : ''
    if (code === 'ENOENT') return
    throw error
  }
  const validated = validateDescriptor(descriptor)
  if (await waitForOwnerShutdown(validated)) return

  const cleanupErrors: unknown[] = []
  if (validated.appProcess) {
    try {
      await terminateSecurityProcessTree(validated.appProcess)
    } catch (error) {
      cleanupErrors.push(error)
    }
  } else if (await isLoopbackPortListening(validated.appBaseUrl)) {
    cleanupErrors.push(new Error('SECURITY_TEARDOWN_PROCESS_IDENTITY_MISSING'))
  }
  try {
    stopTestServices({ composeProjectName: validated.composeProjectName })
  } catch (error) {
    cleanupErrors.push(error)
  }
  try {
    await rm(path.resolve(process.cwd(), validated.tsconfigPath), { force: true })
  } catch (error) {
    cleanupErrors.push(error)
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'SECURITY_TEARDOWN_RECOVERY_FAILED')
  }
}
