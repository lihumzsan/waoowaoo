import { prisma } from '@/lib/prisma'
import { toMoneyNumber } from '@/lib/billing/money'
import { rollbackFreeze } from '@/lib/billing/ledger'
import { TASK_STATUS } from '@/lib/task/types'

type CleanupStats = {
  scanned: number
  stale: number
  activeTaskSkipped: number
  rolledBack: number
  skipped: number
  errors: number
}

function hasApplyFlag() {
  return process.argv.includes('--apply')
}

function parseHoursArg(defaultHours: number) {
  const arg = process.argv.find((item) => item.startsWith('--hours='))
  if (!arg) return defaultHours
  const value = Number(arg.slice('--hours='.length))
  if (!Number.isFinite(value) || value <= 0) return defaultHours
  return Math.floor(value)
}

function writeJson(payload: unknown) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
}

function writeError(payload: unknown) {
  process.stderr.write(
    `${typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)}\n`,
  )
}

async function main() {
  const apply = hasApplyFlag()
  const hours = parseHoursArg(24)
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000)

  const pending = await prisma.balanceFreeze.findMany({
    where: {
      status: 'pending',
      createdAt: { lt: cutoff },
    },
    orderBy: { createdAt: 'asc' },
  })
  const taskIds = pending.flatMap((freeze) => (freeze.taskId ? [freeze.taskId] : []))
  const tasks =
    taskIds.length > 0
      ? await prisma.task.findMany({
          where: { id: { in: taskIds } },
          select: { id: true, status: true },
        })
      : []
  const taskStatusById = new Map(tasks.map((task) => [task.id, task.status]))
  const isActiveTaskFreeze = (taskId: string | null): boolean => {
    if (!taskId) return false
    const status = taskStatusById.get(taskId)
    return status === TASK_STATUS.QUEUED || status === TASK_STATUS.PROCESSING
  }
  const eligible = pending.filter((freeze) => !isActiveTaskFreeze(freeze.taskId))

  const stats: CleanupStats = {
    scanned: pending.length,
    stale: eligible.length,
    activeTaskSkipped: pending.length - eligible.length,
    rolledBack: 0,
    skipped: 0,
    errors: 0,
  }

  if (!apply) {
    writeJson({
      mode: 'dry-run',
      hours,
      cutoff: cutoff.toISOString(),
      stalePendingCount: eligible.length,
      activeTaskSkipped: stats.activeTaskSkipped,
      stalePending: eligible.map((f) => ({
        id: f.id,
        userId: f.userId,
        amount: toMoneyNumber(f.amount),
        createdAt: f.createdAt.toISOString(),
      })),
    })
    return
  }

  for (const freeze of eligible) {
    try {
      const rolledBack = await rollbackFreeze(freeze.id)
      if (rolledBack) stats.rolledBack += 1
      else stats.errors += 1
    } catch (error) {
      stats.errors += 1
      writeError({
        tag: 'billing-cleanup-pending-freezes.rollback_failed',
        freezeId: freeze.id,
        userId: freeze.userId,
        amount: toMoneyNumber(freeze.amount),
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  writeJson({
    mode: 'apply',
    hours,
    cutoff: cutoff.toISOString(),
    stats,
  })
}

main()
  .catch((error) => {
    writeError({
      tag: 'billing-cleanup-pending-freezes.fatal',
      error: error instanceof Error ? error.message : String(error),
    })
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
