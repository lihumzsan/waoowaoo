import type { AgentInputItem } from '@openai/agents'
import { prisma } from '@/lib/prisma'

const INTERRUPTED_EFFECT_DIGEST_MAX_BYTES = 1_024 * 1_024

export interface InterruptedTurnEffectDigest {
  protocol: 'interrupted_turn_effect_digest_v1'
  priorTurnId: string
  completedEffects: readonly {
    callId: string
    operationId: string
    result: unknown
  }[]
  createdTaskIds: readonly string[]
  createdResourceIds: readonly string[]
  outcomeUnknownEffects: readonly {
    taskId: string
    operationId: string | null
    errorCode: string
  }[]
}

function cloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown
}

async function loadInterruptedTurnEffectDigest(
  currentTurnId: string,
): Promise<InterruptedTurnEffectDigest | null> {
  const current = await prisma.projectAgentTurn.findUnique({
    where: { id: currentTurnId },
    select: {
      id: true,
      threadId: true,
      status: true,
      startedAt: true,
      modelHistoryBaseVersion: true,
    },
  })
  if (
    !current
    || current.status !== 'running'
    || current.startedAt === null
    || current.modelHistoryBaseVersion === null
  ) {
    throw new Error(
      `INTERRUPTED_EFFECT_DIGEST_CURRENT_TURN_INVALID:${currentTurnId}`,
    )
  }
  const prior = await prisma.projectAgentTurn.findFirst({
    where: {
      id: { not: current.id },
      threadId: current.threadId,
      status: 'interrupted',
      modelHistoryBaseVersion: current.modelHistoryBaseVersion,
      startedAt: { lte: current.startedAt },
    },
    orderBy: [
      { startedAt: 'desc' },
      { createdAt: 'desc' },
      { id: 'desc' },
    ],
    select: { id: true },
  })
  if (!prior) return null
  const [effects, batches] = await Promise.all([
    prisma.agentToolEffect.findMany({
      where: { turnId: prior.id },
      orderBy: [{ completedAt: 'asc' }, { callId: 'asc' }],
      select: {
        callId: true,
        operationId: true,
        resultJson: true,
      },
    }),
    prisma.followUpBatch.findMany({
      where: { originTurnId: prior.id },
      orderBy: { id: 'asc' },
      include: {
        members: {
          orderBy: { taskId: 'asc' },
          include: {
            task: {
              select: {
                id: true,
                operationId: true,
                errorCode: true,
                creativeResources: {
                  select: { id: true },
                  orderBy: { id: 'asc' },
                },
              },
            },
          },
        },
      },
    }),
  ])
  const tasks = batches.flatMap((batch) => (
    batch.members.map((member) => member.task)
  ))
  const digest: InterruptedTurnEffectDigest = {
    protocol: 'interrupted_turn_effect_digest_v1',
    priorTurnId: prior.id,
    completedEffects: effects.map((effect) => ({
      callId: effect.callId,
      operationId: effect.operationId,
      result: cloneJson(effect.resultJson),
    })),
    createdTaskIds: [...new Set(tasks.map((task) => task.id))].sort(),
    createdResourceIds: [
      ...new Set(
        tasks.flatMap((task) => (
          task.creativeResources.map((resource) => resource.id)
        )),
      ),
    ].sort(),
    outcomeUnknownEffects: tasks
      .filter(
        (task) => task.errorCode === 'PROVIDER_SUBMISSION_OUTCOME_UNKNOWN',
      )
      .map((task) => ({
        taskId: task.id,
        operationId: task.operationId,
        errorCode: 'PROVIDER_SUBMISSION_OUTCOME_UNKNOWN',
      }))
      .sort((left, right) => left.taskId.localeCompare(right.taskId)),
  }
  const serialized = JSON.stringify(digest)
  if (
    Buffer.byteLength(serialized, 'utf8')
    > INTERRUPTED_EFFECT_DIGEST_MAX_BYTES
  ) {
    throw new Error(
      `INTERRUPTED_EFFECT_DIGEST_TOO_LARGE:${prior.id}`,
    )
  }
  return digest
}

export async function loadInterruptedTurnEffectDigestInput(
  currentTurnId: string,
): Promise<AgentInputItem | null> {
  const digest = await loadInterruptedTurnEffectDigest(currentTurnId)
  if (!digest) return null
  return {
    role: 'user',
    content: [
      '[interrupted_turn_effect_digest]',
      JSON.stringify(digest),
      'The prior Turn was interrupted after these durable effects were committed. Treat them as already performed. Do not repeat an effect merely because its unfinished model output is absent.',
      '[/interrupted_turn_effect_digest]',
    ].join('\n'),
  } satisfies AgentInputItem
}
