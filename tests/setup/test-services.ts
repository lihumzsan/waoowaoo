import { execSync } from 'node:child_process'
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

function run(command: string) {
  execSync(command, {
    cwd: process.cwd(),
    stdio: 'inherit',
  })
}

export async function waitForMysql(maxAttempts = 180) {
  const db = parseDbUrl(process.env.DATABASE_URL || '')

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const conn = await mysql.createConnection({
        host: db.host,
        port: db.port,
        user: db.user,
        password: db.password,
        database: db.database,
        connectTimeout: 5_000,
      })
      await conn.query('SELECT 1')
      await conn.end()
      return
    } catch {
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
      } catch {
        await sleep(1_000)
      }
    }
  } finally {
    redis.disconnect()
  }

  throw new Error('Redis test service did not become ready in time')
}

export function startTestServices() {
  loadTestEnv()
  run('docker compose -f docker-compose.test.yml up -d --remove-orphans')
}

export function stopTestServices() {
  loadTestEnv()
  run('docker compose -f docker-compose.test.yml down -v --remove-orphans')
}

export async function waitForTestServices() {
  loadTestEnv()
  await waitForMysql()
  await waitForRedis()
}

export function pushTestSchema() {
  loadTestEnv()
  run('npx prisma db push --skip-generate --schema prisma/schema.prisma')
}

export async function prepareFreshTestServices() {
  stopTestServices()
  startTestServices()
  await waitForTestServices()
  pushTestSchema()
}
