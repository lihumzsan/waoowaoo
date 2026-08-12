import { markAssistantRuntimeProjectTurnsInterrupted } from '@/lib/assistant-runtime/persistence'
import { prisma } from '@/lib/prisma'

type RuntimeScope = {
  readonly projectId: string
  readonly userId: string
}

function scopeKey(scope: RuntimeScope): string {
  return `${scope.projectId.length}:${scope.projectId}${scope.userId.length}:${scope.userId}`
}

async function main(): Promise<void> {
  const activeTurns = await prisma.projectAgentTurn.findMany({
    where: { status: { in: ['running', 'waiting_approval'] } },
    select: { projectId: true, userId: true },
  })
  const scopes = new Map<string, RuntimeScope>()
  for (const turn of activeTurns) {
    const scope = { projectId: turn.projectId, userId: turn.userId }
    scopes.set(scopeKey(scope), scope)
  }
  for (const scope of scopes.values()) {
    await markAssistantRuntimeProjectTurnsInterrupted({
      scope,
      runtimeThreadId: null,
      runtimeTurnId: null,
      reason: 'runtime_reconciled_during_deploy',
    })
  }
  process.stdout.write(`ASSISTANT_RUNTIME_ROLLOUT_RECONCILED scopes=${scopes.size}\n`)
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR'
    process.stderr.write(`ASSISTANT_RUNTIME_ROLLOUT_RECONCILIATION_FAILED:${message}\n`)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
