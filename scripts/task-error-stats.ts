import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'
import { prisma } from '@/lib/prisma'
import { parseFailureRecord } from '@/lib/errors/failure'

function parseMinutesArg() {
  const raw = process.argv.find((arg) => arg.startsWith('--minutes='))
  const value = raw ? Number.parseInt(raw.split('=')[1], 10) : 5
  return Number.isFinite(value) && value > 0 ? value : 5
}

async function main() {
  const minutes = parseMinutesArg()
  const since = new Date(Date.now() - minutes * 60_000)

  const rows = await prisma.task.findMany({
    where: {
      status: 'failed',
      finishedAt: { gte: since },
    },
    select: { failure: true },
  })

  const counts = new Map<string, number>()
  for (const row of rows) {
    const code = parseFailureRecord(row.failure)?.interpretation.code ?? 'UNKNOWN'
    counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  const total = rows.length

  _ulogInfo(`[TaskErrorStats] window=${minutes}m failed_total=${total}`)
  if (!counts.size) {
    _ulogInfo('No failed tasks in the selected window.')
    return
  }

  for (const [code, count] of [...counts].sort((left, right) => right[1] - left[1])) {
    const ratio = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0'
    _ulogInfo(`${code}\t${count}\t${ratio}%`)
  }
}

main()
  .catch((error) => {
    _ulogError('[TaskErrorStats] failed:', error?.message || error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
