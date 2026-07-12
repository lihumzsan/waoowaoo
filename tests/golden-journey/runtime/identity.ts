import { randomInt, randomUUID } from 'node:crypto'
import path from 'node:path'

export interface GoldenRuntimeIdentity {
  readonly runtimeId: string
  readonly appPort: number
  readonly coordinatorPort: number
  readonly artifactRoot: string
  readonly distDir: string
  readonly uploadDir: string
}

function readPort(value: string | undefined, name: string): number | null {
  if (!value?.trim()) return null
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error(`GOLDEN_RUNTIME_PORT_INVALID:${name}:${value}`)
  }
  return port
}

export function resolveGoldenRuntimeIdentity(
  environment: NodeJS.ProcessEnv = process.env,
): GoldenRuntimeIdentity {
  const configuredAppPort = readPort(environment.GOLDEN_APP_PORT, 'GOLDEN_APP_PORT')
  const configuredCoordinatorPort = readPort(
    environment.GOLDEN_COORDINATOR_PORT,
    'GOLDEN_COORDINATOR_PORT',
  )
  if ((configuredAppPort === null) !== (configuredCoordinatorPort === null)) {
    throw new Error('GOLDEN_RUNTIME_PORTS_PARTIAL')
  }
  const appPort = configuredAppPort ?? randomInt(20_000, 45_000)
  let coordinatorPort = configuredCoordinatorPort ?? randomInt(45_001, 60_000)
  while (coordinatorPort === appPort) coordinatorPort = randomInt(45_001, 60_000)
  const runtimeId = environment.GOLDEN_RUNTIME_ID?.trim()
    || randomUUID().replaceAll('-', '').slice(0, 16)
  return {
    runtimeId,
    appPort,
    coordinatorPort,
    artifactRoot: `artifacts/golden-journey/runs/${runtimeId}`,
    distDir: `.next-golden/${runtimeId}`,
    uploadDir: `artifacts/golden-journey/runs/${runtimeId}/uploads`,
  }
}

export function applyGoldenRuntimeIdentity(
  identity: GoldenRuntimeIdentity,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  environment.GOLDEN_RUNTIME_ID = identity.runtimeId
  environment.GOLDEN_APP_PORT = String(identity.appPort)
  environment.GOLDEN_COORDINATOR_PORT = String(identity.coordinatorPort)
  environment.GOLDEN_ARTIFACT_ROOT = identity.artifactRoot
  environment.NEXT_DIST_DIR = identity.distDir
  environment.UPLOAD_DIR = identity.uploadDir
}

export function resolveGoldenArtifactRoot(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const artifactRoot = environment.GOLDEN_ARTIFACT_ROOT?.trim()
  if (!artifactRoot) throw new Error('GOLDEN_ARTIFACT_ROOT_MISSING')
  return path.resolve(process.cwd(), artifactRoot)
}
