import type { AgentInputItem } from '@openai/agents'
import { prisma } from '@/lib/prisma'
import { validateProjectAssistantThreadMessages } from '@/lib/project-agent/persistence'
import { AGENT_TURN_SOURCE_KIND } from './contracts'
import { loadResolvedAgentTurnChoiceInput } from './choice'
import { loadAgentTurnFollowUpInput } from './follow-up-batch'
import { buildAgentTurnUserInputItem } from './runner-input'

const INTERRUPTED_EFFECT_DIGEST_MAX_BYTES = 1_024 * 1_024

export interface InterruptedTurnEffectDigest {
  protocol: 'interrupted_turn_continuation_v3'
  priorTurnIds: readonly string[]
  sourceFacts: readonly {
    turnId: string
    sourceKind: string
    sourceId: string
    terminalStatus: string
    sourceCommittedToHistory: boolean
  }[]
  completedEffects: readonly {
    turnId: string
    callId: string
    operationId: string
    result: unknown
  }[]
  createdTaskIds: readonly string[]
  createdResourceIds: readonly string[]
  outcomeUnknownEffects: readonly {
    turnId: string
    taskId: string
    operationId: string | null
    errorCode: string
  }[]
}

function cloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown
}

async function loadInterruptedTurnEffectDigest(currentTurnId: string): Promise<{
  digest: InterruptedTurnEffectDigest
  sourceInputs: readonly AgentInputItem[]
} | null> {
  const current = await prisma.projectAgentTurn.findUnique({
    where: { id: currentTurnId },
    select: {
      id: true,
      threadId: true,
      status: true,
      startedAt: true,
      createdAt: true,
      modelHistoryBaseVersion: true,
    },
  })
  if (
    !current ||
    current.status !== 'running' ||
    current.startedAt === null ||
    current.modelHistoryBaseVersion === null
  ) {
    throw new Error(`INTERRUPTED_EFFECT_DIGEST_CURRENT_TURN_INVALID:${currentTurnId}`)
  }
  const priorTurns = await prisma.projectAgentTurn.findMany({
    where: {
      id: { not: current.id },
      threadId: current.threadId,
      status: { in: ['interrupted', 'failed', 'cancelled'] },
      modelHistoryBaseVersion: current.modelHistoryBaseVersion,
      createdAt: { lte: current.createdAt },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      sourceKind: true,
      sourceId: true,
      status: true,
      stopReason: true,
      userMessageJson: true,
    },
  })
  if (priorTurns.length === 0) return null
  const priorTurnIds = priorTurns.map((turn) => turn.id)
  const [effects, batches, approvalCheckpoints] = await Promise.all([
    prisma.agentToolEffect.findMany({
      where: { turnId: { in: priorTurnIds } },
      orderBy: [{ completedAt: 'asc' }, { turnId: 'asc' }, { callId: 'asc' }],
      select: {
        turnId: true,
        callId: true,
        operationId: true,
        resultJson: true,
      },
    }),
    prisma.followUpBatch.findMany({
      where: { originTurnId: { in: priorTurnIds } },
      orderBy: [{ originTurnId: 'asc' }, { id: 'asc' }],
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
    prisma.agentTurnInteraction.findMany({
      where: {
        turnId: { in: priorTurnIds },
        kind: 'approval',
      },
      select: { turnId: true },
      distinct: ['turnId'],
    }),
  ])
  const sourceCommittedTurnIds = new Set(
    approvalCheckpoints.map((interaction) => interaction.turnId),
  )
  const tasks = batches.flatMap((batch) =>
    batch.members.map((member) => ({
      ...member.task,
      turnId: batch.originTurnId,
    })),
  )
  const digest: InterruptedTurnEffectDigest = {
    protocol: 'interrupted_turn_continuation_v3',
    priorTurnIds,
    sourceFacts: priorTurns.map((turn) => ({
      turnId: turn.id,
      sourceKind: turn.sourceKind,
      sourceId: turn.sourceId,
      terminalStatus: turn.status,
      sourceCommittedToHistory: sourceCommittedTurnIds.has(turn.id),
    })),
    completedEffects: effects.map((effect) => ({
      turnId: effect.turnId,
      callId: effect.callId,
      operationId: effect.operationId,
      result: cloneJson(effect.resultJson),
    })),
    createdTaskIds: [...new Set(tasks.map((task) => task.id))].sort(),
    createdResourceIds: [
      ...new Set(tasks.flatMap((task) => task.creativeResources.map((resource) => resource.id))),
    ].sort(),
    outcomeUnknownEffects: tasks
      .filter((task) => task.errorCode === 'PROVIDER_SUBMISSION_OUTCOME_UNKNOWN')
      .map((task) => ({
        turnId: task.turnId,
        taskId: task.id,
        operationId: task.operationId,
        errorCode: 'PROVIDER_SUBMISSION_OUTCOME_UNKNOWN',
      }))
      .sort((left, right) => left.taskId.localeCompare(right.taskId)),
  }
  const sourceInputs = (
    await Promise.all(
      priorTurns
        .flatMap((turn) => (sourceCommittedTurnIds.has(turn.id) ? [] : [turn]))
        .map(async (turn) => {
          let sourceInput: AgentInputItem
          if (turn.sourceKind === AGENT_TURN_SOURCE_KIND.USER) {
            if (turn.userMessageJson === null) {
              throw new Error(`INTERRUPTED_TURN_USER_SOURCE_MISSING:${turn.id}`)
            }
            const messages = await validateProjectAssistantThreadMessages([turn.userMessageJson])
            const message = messages[0]
            if (!message || message.role !== 'user') {
              throw new Error(`INTERRUPTED_TURN_USER_SOURCE_INVALID:${turn.id}`)
            }
            sourceInput = buildAgentTurnUserInputItem(message)
          } else if (turn.sourceKind === AGENT_TURN_SOURCE_KIND.CHOICE_RESPONSE) {
            sourceInput = await loadResolvedAgentTurnChoiceInput({
              turnId: turn.id,
              offerId: turn.sourceId,
            })
          } else if (turn.sourceKind === AGENT_TURN_SOURCE_KIND.TASK_FOLLOW_UP) {
            sourceInput = await loadAgentTurnFollowUpInput({
              turnId: turn.id,
              batchId: turn.sourceId,
            })
          } else {
            throw new Error(`INTERRUPTED_TURN_SOURCE_KIND_INVALID:${turn.id}:${turn.sourceKind}`)
          }
          const continuationInstruction =
            turn.status === 'cancelled' && turn.stopReason === 'superseded_by_user_turn'
              ? 'A newer user message superseded this Turn before its assistant output completed. Preserve this source as preceding conversation context, reconcile it with the newer input, and let the latest user instruction win.'
              : turn.status === 'cancelled'
                ? 'This source belonged to a cancelled Turn. Preserve it as conversation context, but do not execute it unless the current Turn explicitly asks.'
                : 'This source belonged to an unfinished Turn whose assistant output was not committed. Preserve its meaning when answering the current Turn.'
          return [
            {
              role: 'user',
              content: [
                '[interrupted_turn_source]',
                `turnId=${turn.id}`,
                `sourceKind=${turn.sourceKind}`,
                `terminalStatus=${turn.status}`,
                continuationInstruction,
              ].join('\n'),
            } satisfies AgentInputItem,
            sourceInput,
            {
              role: 'user',
              content: '[/interrupted_turn_source]',
            } satisfies AgentInputItem,
          ]
        }),
    )
  ).flat()
  const serialized = JSON.stringify({ digest, sourceInputs })
  if (Buffer.byteLength(serialized, 'utf8') > INTERRUPTED_EFFECT_DIGEST_MAX_BYTES) {
    throw new Error(`INTERRUPTED_EFFECT_DIGEST_TOO_LARGE:${priorTurnIds.join(',')}`)
  }
  return { digest, sourceInputs }
}

export async function loadInterruptedTurnContinuationInputs(
  currentTurnId: string,
): Promise<readonly AgentInputItem[]> {
  const continuation = await loadInterruptedTurnEffectDigest(currentTurnId)
  if (!continuation) return []
  const digestInput = {
    role: 'user',
    content: [
      '[interrupted_turn_continuation]',
      JSON.stringify(continuation.digest),
      'The preceding preserved source items came from prior unfinished Turns. Treat listed durable effects as already performed and do not repeat them merely because unfinished assistant output is absent.',
      '[/interrupted_turn_continuation]',
    ].join('\n'),
  } satisfies AgentInputItem
  return [...continuation.sourceInputs, digestInput]
}
