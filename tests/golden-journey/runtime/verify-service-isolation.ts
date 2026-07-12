import { randomUUID } from 'node:crypto'
import mysql from 'mysql2/promise'
import Redis from 'ioredis'
import {
  startTestServices,
  stopTestServices,
  waitForTestServices,
  type TestServiceEndpoints,
  type TestServiceScope,
} from '../../setup/test-services'

async function assertEndpointsHealthy(endpoints: TestServiceEndpoints): Promise<void> {
  const connection = await mysql.createConnection(endpoints.databaseUrl)
  try {
    await connection.query('SELECT 1')
  } finally {
    await connection.end()
  }

  const redis = new Redis({
    host: endpoints.redisHost,
    port: endpoints.redisPort,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  })
  try {
    await redis.connect()
    const pong = await redis.ping()
    if (pong !== 'PONG') throw new Error(`GOLDEN_ISOLATION_REDIS_UNHEALTHY:${pong}`)
  } finally {
    redis.disconnect()
  }
}

async function main(): Promise<void> {
  const runId = randomUUID().replaceAll('-', '').slice(0, 12)
  const first: Required<TestServiceScope> = {
    composeProjectName: `waoowaoo-isolation-a-${runId}`,
  }
  const second: Required<TestServiceScope> = {
    composeProjectName: `waoowaoo-isolation-b-${runId}`,
  }
  let firstStarted = false
  let secondStarted = false
  const readiness = {
    mysqlMaxAttempts: 15,
    mysqlConnectTimeoutMs: 1_000,
    redisMaxAttempts: 15,
  } as const
  try {
    startTestServices(first)
    firstStarted = true
    const firstEndpoints = await waitForTestServices(first, readiness)
    startTestServices(second)
    secondStarted = true
    const secondEndpoints = await waitForTestServices(second, readiness)

    if (firstEndpoints.databaseUrl === secondEndpoints.databaseUrl) {
      throw new Error('GOLDEN_ISOLATION_DATABASE_ENDPOINT_SHARED')
    }
    if (firstEndpoints.redisPort === secondEndpoints.redisPort) {
      throw new Error('GOLDEN_ISOLATION_REDIS_ENDPOINT_SHARED')
    }

    await assertEndpointsHealthy(firstEndpoints)
    await assertEndpointsHealthy(secondEndpoints)
    stopTestServices(first)
    firstStarted = false
    await assertEndpointsHealthy(secondEndpoints)
    console.log('Golden test-service isolation verified: independent MySQL and Redis scopes')
  } finally {
    if (firstStarted) stopTestServices(first)
    if (secondStarted) stopTestServices(second)
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
