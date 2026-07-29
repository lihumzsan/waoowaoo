import { randomInt, randomUUID } from 'node:crypto'
import path from 'node:path'

export interface SecurityRuntimeIdentity {
  readonly runtimeId: string
  readonly appPort: number
  readonly coordinatorPort: number
  readonly artifactRoot: string
  readonly distDir: string
  readonly tsconfigPath: string
  readonly uploadDir: string
}

function readPort(value: string | undefined, name: string): number | null {
  if (!value?.trim()) return null
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error(`SECURITY_RUNTIME_PORT_INVALID:${name}:${value}`)
  }
  return port
}

export function resolveSecurityRuntimeIdentity(
  environment: NodeJS.ProcessEnv = process.env,
): SecurityRuntimeIdentity {
  const configuredAppPort = readPort(environment.SECURITY_APP_PORT, 'SECURITY_APP_PORT')
  const configuredCoordinatorPort = readPort(
    environment.SECURITY_COORDINATOR_PORT,
    'SECURITY_COORDINATOR_PORT',
  )
  if ((configuredAppPort === null) !== (configuredCoordinatorPort === null)) {
    throw new Error('SECURITY_RUNTIME_PORTS_PARTIAL')
  }
  const appPort = configuredAppPort ?? randomInt(20_000, 45_000)
  let coordinatorPort = configuredCoordinatorPort ?? randomInt(45_001, 60_000)
  while (coordinatorPort === appPort) coordinatorPort = randomInt(45_001, 60_000)
  const runtimeId = environment.SECURITY_RUNTIME_ID?.trim()
    || randomUUID().replaceAll('-', '').slice(0, 16)
  return {
    runtimeId,
    appPort,
    coordinatorPort,
    artifactRoot: `artifacts/browser-security/runs/${runtimeId}`,
    distDir: `.next-security/${runtimeId}`,
    tsconfigPath: `.tsconfig-security-${runtimeId}.json`,
    uploadDir: `artifacts/browser-security/runs/${runtimeId}/uploads`,
  }
}

export function applySecurityRuntimeIdentity(
  identity: SecurityRuntimeIdentity,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  environment.SECURITY_RUNTIME_ID = identity.runtimeId
  environment.SECURITY_APP_PORT = String(identity.appPort)
  environment.SECURITY_COORDINATOR_PORT = String(identity.coordinatorPort)
  environment.SECURITY_ARTIFACT_ROOT = identity.artifactRoot
  environment.NEXT_DIST_DIR = identity.distDir
  environment.NEXT_TSCONFIG_PATH = identity.tsconfigPath
  environment.UPLOAD_DIR = identity.uploadDir
}

export function resolveSecurityArtifactRoot(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const artifactRoot = environment.SECURITY_ARTIFACT_ROOT?.trim()
  if (!artifactRoot) throw new Error('SECURITY_ARTIFACT_ROOT_MISSING')
  return path.resolve(process.cwd(), artifactRoot)
}
