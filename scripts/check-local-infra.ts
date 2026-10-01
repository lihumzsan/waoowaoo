import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import { getStorageProvider } from '@/lib/storage'
import { ensureStorageReady } from '@/lib/storage/bootstrap'
import { connectTemporalClient } from '@/lib/temporal/client'
import { getTemporalRuntimeConfig } from '@/lib/temporal/config'
import { normalizeAnyError } from '@/lib/errors/normalize'
import { createScopedLogger } from '@/lib/logging/core'

const logger = createScopedLogger({ module: 'local-infra.check' })

// Check the same host-side clients used by Web and Worker. Container health
// alone cannot detect stale Docker Desktop port forwarding after a WSL restart.
async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length > 1 || (args.length === 1 && args[0] !== '--initialize-storage')) {
    throw new Error('INFRA_CHECK_ARGUMENT_INVALID')
  }
  const initializeStorage = args[0] === '--initialize-storage'
  const pending = new Set(['mysql', 'redis', 'storage', 'temporal'])
  const deadline = setTimeout(() => {
    console.error(`[infra:check] timeout: ${[...pending].join(', ')}`)
    console.error('[infra:check] Restart Docker Desktop after a WSL update, then rerun npm run infra:check.')
    process.exit(1)
  }, 20_000)

  const checks = [
    {
      name: 'mysql',
      run: async () => {
        try {
          await prisma.$queryRaw`SELECT 1`
        } finally {
          await prisma.$disconnect()
        }
      },
    },
    {
      name: 'redis',
      run: async () => {
        try {
          if (await redis.ping() !== 'PONG') throw new Error('REDIS_PING_INVALID')
        } finally {
          redis.disconnect()
        }
      },
    },
    {
      name: 'storage',
      run: async () => {
        if (initializeStorage) await ensureStorageReady()
        else await getStorageProvider().verifyReady()
      },
    },
    {
      name: 'temporal',
      run: async () => {
        const config = getTemporalRuntimeConfig()
        const connected = await connectTemporalClient(config)
        try {
          await connected.client.workflowService.describeNamespace({ namespace: config.namespace })
        } finally {
          await connected.close()
        }
      },
    },
  ]

  try {
    const results = await Promise.allSettled(checks.map(async ({ name, run }) => {
      try {
        await run()
        console.log(`[infra:check] ${name}: OK`)
      } catch (error) {
        logger.error({
          action: 'infra.check.failed',
          message: `Infrastructure check failed: ${name}`,
          details: {
            service: name,
            failure: normalizeAnyError(error, {
              context: { system: 'runtime', phase: 'local-infra-preflight' },
            }),
          },
        })
        throw error
      } finally {
        pending.delete(name)
      }
    }))
    const failed = results.flatMap((result, index) => result.status === 'rejected' ? [checks[index].name] : [])
    if (failed.length > 0) {
      // Keep connection strings, credentials and provider response bodies out
      // of the terminal; the service names identify which connection to check.
      throw new Error(`INFRA_UNREACHABLE:${failed.join(',')}`)
    }
  } finally {
    clearTimeout(deadline)
  }
}

void main().catch((error: unknown) => {
  console.error('[infra:check]', error instanceof Error ? error.message : 'INFRA_CHECK_FAILED')
  console.error('[infra:check] Check the host endpoints in .env. After a WSL update, restart Docker Desktop and rerun npm run infra:check.')
  process.exit(1)
})
