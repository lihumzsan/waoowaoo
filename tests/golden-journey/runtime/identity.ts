import { randomInt, randomUUID } from 'node:crypto'

export interface GoldenRuntimeIdentity {
  readonly runtimeId: string
  readonly appPort: number
  readonly coordinatorPort: number
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
  return { runtimeId, appPort, coordinatorPort }
}

export function applyGoldenRuntimeIdentity(
  identity: GoldenRuntimeIdentity,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  environment.GOLDEN_RUNTIME_ID = identity.runtimeId
  environment.GOLDEN_APP_PORT = String(identity.appPort)
  environment.GOLDEN_COORDINATOR_PORT = String(identity.coordinatorPort)
}
