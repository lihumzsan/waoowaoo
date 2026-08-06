import type { Prisma } from '@prisma/client'
import { getTaskDefinition } from './definition'
import type { TaskType } from './types'

export type TaskTargetTerminalKind = 'completed' | 'failed' | 'canceled'

export type TaskTargetTerminalProjection = {
  readonly kind: TaskTargetTerminalKind
  readonly taskId: string
  readonly type: TaskType
  readonly targetType: string
  readonly targetId: string
}

export type TaskTargetTerminalProjectionResult = 'applied' | 'stale_owner' | 'success_materialized'

/**
 * All surviving Task targets are Creative Resources. Their terminal state is
 * committed by the unique Resource materializer, so there is no second
 * domain-status projector to race it.
 */
export async function projectTaskTargetTerminalInTransaction(
  tx: Prisma.TransactionClient,
  input: TaskTargetTerminalProjection,
): Promise<TaskTargetTerminalProjectionResult> {
  void tx
  const definition = getTaskDefinition(input.type)
  if (
    definition.terminalFailureProjector !== 'none'
    || definition.terminalCancelProjector !== 'none'
  ) {
    throw new Error(`TASK_DOMAIN_TERMINAL_PROJECTOR_FORBIDDEN:${input.type}`)
  }
  return 'applied'
}
