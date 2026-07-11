import { prisma } from '@/lib/prisma'

export type AsyncMigrationPreflightCounts = {
  readonly activeTasks: number
  readonly legacyStyleParentTasks: number
  readonly pendingOutboxCommands: number
  readonly activeAssistantRuns: number
  readonly activeAssistantWaits: number
}

export function assertAsyncMigrationPreflightClear(counts: AsyncMigrationPreflightCounts): void {
  const blockers = Object.entries(counts).filter(([, count]) => count !== 0)
  if (blockers.length === 0) return
  throw new Error(`ASYNC_MIGRATION_PREFLIGHT_BLOCKED:${blockers.map(([name, count]) => `${name}=${String(count)}`).join(',')}`)
}

export async function readAsyncMigrationPreflightCounts(): Promise<AsyncMigrationPreflightCounts> {
  const [
    activeTasks,
    legacyStyleParentTasks,
    pendingOutboxCommands,
    activeAssistantRuns,
    activeAssistantWaits,
  ] = await Promise.all([
    prisma.task.count({ where: { status: { in: ['queued', 'processing'] } } }),
    prisma.task.count({ where: { type: 'edit_style_previews_generate' } }),
    prisma.outboxCommand.count({ where: { acceptedAt: null, deadAt: null } }),
    prisma.projectAgentRun.count({
      where: { status: { in: ['running', 'awaiting_approval', 'awaiting_choice', 'awaiting_task'] } },
    }),
    prisma.projectAgentWait.count({ where: { status: { in: ['pending', 'resolved', 'claimed'] } } }),
  ])
  return {
    activeTasks,
    legacyStyleParentTasks,
    pendingOutboxCommands,
    activeAssistantRuns,
    activeAssistantWaits,
  }
}

async function main(): Promise<void> {
  try {
    const counts = await readAsyncMigrationPreflightCounts()
    assertAsyncMigrationPreflightClear(counts)
    process.stdout.write(`[async-migration-preflight] OK ${JSON.stringify(counts)}\n`)
  } finally {
    await prisma.$disconnect()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    process.stderr.write(`[async-migration-preflight] ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
