import {
  Prisma,
  type ProjectAgentTurn,
  type ProjectAssistantThread,
} from '@prisma/client'

/**
 * Serializes a model-authored side effect with cancellation on the Project
 * lock. If cancellation commits first, no new mutation may begin; if this
 * fence commits first, the effect happened-before the later cancellation.
 */
export async function lockAgentTurnEffectFence(
  tx: Prisma.TransactionClient,
  input: {
    readonly turnId: string
    readonly projectId: string
    readonly userId: string
  },
): Promise<ProjectAgentTurn> {
  const projects = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM projects
    WHERE id = ${input.projectId} AND userId = ${input.userId}
    FOR UPDATE
  `)
  if (projects.length !== 1) {
    throw new Error(`AGENT_TURN_EFFECT_PROJECT_DIVERGED:${input.turnId}`)
  }
  const threads = await tx.$queryRaw<ProjectAssistantThread[]>(Prisma.sql`
    SELECT *
    FROM project_assistant_threads
    WHERE projectId = ${input.projectId}
      AND userId = ${input.userId}
      AND assistantId = 'workspace-command'
    FOR UPDATE
  `)
  const thread = threads[0] ?? null
  const turns = await tx.$queryRaw<ProjectAgentTurn[]>(Prisma.sql`
    SELECT *
    FROM project_agent_turns
    WHERE id = ${input.turnId}
    FOR UPDATE
  `)
  const turn = turns[0] ?? null
  if (
    !turn
    || !thread
    || turn.threadId !== thread.id
    || turn.projectId !== input.projectId
    || turn.userId !== input.userId
    || thread.clearRequestId !== null
    || (turn.status !== 'running' && turn.status !== 'waiting_approval')
    || turn.cancelRequestId !== null
  ) {
    throw new Error(
      `AGENT_TURN_EFFECT_FENCE_DIVERGED:${input.turnId}:${turn?.status ?? 'missing'}`,
    )
  }
  return turn
}
