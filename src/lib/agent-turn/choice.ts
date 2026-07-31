import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { Prisma, type ProjectAgentTurn } from '@prisma/client'
import type { AgentInputItem } from '@openai/agents'
import type { UIMessage } from 'ai'
import enAssistantAgentMessages from '../../../messages/en/assistantAgent.json'
import zhAssistantAgentMessages from '../../../messages/zh/assistantAgent.json'
import { prisma } from '@/lib/prisma'
import type { LlmUsageFact } from '@/lib/billing/llm-usage'
import { invokeProjectAgentOperation } from '@/lib/operations/invocation'
import { projectOperationMutationReceipt } from '@/lib/operations/mutation-receipt'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import { publishOperationMutationReceipt } from '@/lib/workspace-resource/resource-change-publisher'
import {
  assertProjectAgentChoiceOfferCurrent,
  buildProjectAgentChoiceOffer,
  parseProjectAgentChoiceDecision,
  parseProjectAgentChoiceOffer,
  projectAgentChoiceCardDefinitionSchema,
  type ProjectAgentChoiceCardDefinition,
  type ProjectAgentChoiceCommitment,
  type ProjectAgentChoiceOffer,
  type ProjectAgentChoiceSubject,
} from '@/lib/project-agent/choice-offer'
import {
  buildProjectAgentChoiceVisibleUserText,
  buildProjectAgentChoiceResponseInputItem,
  resolveProjectAgentChoiceCommitment,
  type ProjectAgentChoiceDecision,
} from '@/lib/project-agent/choice-result'
import {
  appendProjectAssistantThreadMessagesInTransaction,
  commitProjectAssistantTurnInTransaction,
  lockProjectAssistantThreadScopeInTransaction,
} from '@/lib/project-agent/persistence'
import type { AgentTurnContextSnapshot, AgentTurnExecutionInput } from './contracts'
import { recordAgentTurnUsageFactsInTransaction } from './usage'

export interface PreparedAgentTurnChoiceOffer {
  protocol: 'agent_turn_choice_offer_v1'
  offerId: string
  operationId: string
  callId: string
  card: ProjectAgentChoiceCardDefinition
  subject: ProjectAgentChoiceSubject
  commitments: readonly ProjectAgentChoiceCommitment[]
  modelArguments: unknown
}

export interface ResolveAgentTurnChoiceCommand {
  protocol: 'agent_turn_choice_response_v1'
  threadId: string
  offerId: string
  projectId: string
  userId: string
  requestId: string
  response: unknown
}

export interface ResolvedAgentTurnChoice {
  offerId: string
  threadId: string
  originalTurnId: string
  projectId: string
  userId: string
  requestId: string
  visibleUserText: string
  decision: ProjectAgentChoiceDecision
  callId: string
  cardId: string
  context: AgentTurnContextSnapshot
}

function requireIdentity(value: string, code: string, maxLength = 191): string {
  if (!value || value !== value.trim() || value.length > maxLength) {
    throw new Error(code)
  }
  return value
}

function requireVisibleUserText(value: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 4_000) {
    throw new Error('AGENT_TURN_CHOICE_VISIBLE_USER_TEXT_INVALID')
  }
  return normalized
}

function buildCanonicalChoiceVisibleUserText(params: {
  card: ProjectAgentChoiceCardDefinition
  decision: ProjectAgentChoiceDecision
  context: AgentTurnContextSnapshot
}): string {
  return buildProjectAgentChoiceVisibleUserText({
    card: params.card,
    decision: params.decision,
    cancelledText:
      params.decision.kind === 'cancelled'
        ? resolveChoiceCancelledVisibleUserText(params.context)
        : '',
  })
}

function resolveChoiceCancelledVisibleUserText(context: AgentTurnContextSnapshot): string {
  const locale = context.locale?.trim().toLowerCase() ?? null
  if (locale === 'en' || locale?.startsWith('en-')) {
    return enAssistantAgentMessages.cards.choiceCancelledResponse
  }
  if (locale === 'zh' || locale?.startsWith('zh-')) {
    return zhAssistantAgentMessages.cards.choiceCancelledResponse
  }
  throw new Error('AGENT_TURN_CHOICE_LOCALE_REQUIRED')
}

function buildChoiceResponseMessage(params: {
  offerId: string
  visibleUserText: string
}): UIMessage {
  const digest = createHash('sha256')
    .update(`agent-turn-choice-response-v1:${params.offerId}`, 'utf8')
    .digest('base64url')
  return {
    id: `choice-response-${digest}`,
    role: 'user',
    parts: [{ type: 'text', text: params.visibleUserText }],
  }
}

function toJson(value: unknown): Prisma.InputJsonValue {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) {
    throw new Error('AGENT_TURN_CHOICE_JSON_INVALID')
  }
  return JSON.parse(serialized) as Prisma.InputJsonValue
}

function parseContext(value: unknown): AgentTurnContextSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AGENT_TURN_CHOICE_CONTEXT_INVALID')
  }
  const record = value as Record<string, unknown>
  const nullable = (key: string): string | null => {
    const candidate = record[key]
    if (candidate === null) return null
    if (typeof candidate !== 'string' || !candidate || candidate !== candidate.trim()) {
      throw new Error(`AGENT_TURN_CHOICE_CONTEXT_FIELD_INVALID:${key}`)
    }
    return candidate
  }
  return {
    locale: nullable('locale'),
    episodeId: nullable('episodeId'),
    selectedScopeRef: nullable('selectedScopeRef'),
    selectedAssetId: nullable('selectedAssetId'),
  }
}

export function parseAgentTurnChoiceOfferPayload(value: unknown): PreparedAgentTurnChoiceOffer {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (value as { protocol?: unknown }).protocol !== 'agent_turn_choice_offer_v1'
  ) {
    throw new Error('AGENT_TURN_CHOICE_OFFER_INVALID')
  }
  const record = value as Record<string, unknown>
  const offerId = requireIdentity(
    String(record.offerId ?? ''),
    'AGENT_TURN_CHOICE_OFFER_ID_INVALID',
  )
  const operationId = requireIdentity(
    String(record.operationId ?? ''),
    'AGENT_TURN_CHOICE_OPERATION_ID_INVALID',
    128,
  )
  const callId = requireIdentity(String(record.callId ?? ''), 'AGENT_TURN_CHOICE_CALL_ID_INVALID')
  const card = projectAgentChoiceCardDefinitionSchema.parse(record.card)
  const offer = parseProjectAgentChoiceOffer({
    card,
    subject: record.subject,
    commitments: record.commitments,
  })
  return {
    protocol: 'agent_turn_choice_offer_v1',
    offerId,
    operationId,
    callId,
    card,
    subject: offer.subject,
    commitments: offer.commitments,
    modelArguments: record.modelArguments,
  }
}

function toProjectAgentChoiceOffer(offer: PreparedAgentTurnChoiceOffer): ProjectAgentChoiceOffer {
  return buildProjectAgentChoiceOffer({
    card: offer.card,
    subject: offer.subject,
    commitments: offer.commitments,
  })
}

export async function settleAgentTurnChoiceOffer(params: {
  input: AgentTurnExecutionInput
  executionOwnerId: string
  assistantMessage: UIMessage
  modelHistoryItems: readonly AgentInputItem[]
  offer: PreparedAgentTurnChoiceOffer
  usageFacts: readonly LlmUsageFact[]
}): Promise<void> {
  if (
    params.offer.offerId !== params.offer.card.cardId ||
    params.offer.operationId !== 'request_choice'
  ) {
    throw new Error('AGENT_TURN_CHOICE_OFFER_IDENTITY_DIVERGED')
  }
  if (
    params.assistantMessage.role !== 'assistant' ||
    !params.assistantMessage.id ||
    params.assistantMessage.id !== params.assistantMessage.id.trim() ||
    params.assistantMessage.id.length > 191
  ) {
    throw new Error('AGENT_TURN_CHOICE_MESSAGE_ID_INVALID')
  }
  const payloadJson = toJson(params.offer)
  const assistantMessage = params.assistantMessage
  await prisma.$transaction(
    async (tx) => {
      await lockProjectAssistantThreadScopeInTransaction(tx, {
        threadId: params.input.turn.threadId,
        projectId: params.input.turn.projectId,
        userId: params.input.turn.userId,
        episodeId: params.input.turn.episodeId,
        assistantId: 'workspace-command',
      })
      const rows = await tx.$queryRaw<ProjectAgentTurn[]>(Prisma.sql`
      SELECT *
      FROM project_agent_turns
      WHERE id = ${params.input.turn.id}
      FOR UPDATE
      `)
      const turn = rows[0] ?? null
      if (!turn) {
        throw new Error(`AGENT_TURN_NOT_FOUND:${params.input.turn.id}`)
      }
      const existing = await tx.agentTurnInteraction.findUnique({
        where: { id: params.offer.offerId },
      })
      if (existing) {
        if (
          existing.turnId !== turn.id ||
          existing.kind !== 'choice' ||
          existing.status !== 'pending' ||
          !isDeepStrictEqual(existing.payloadJson, payloadJson) ||
          turn.status !== 'completed' ||
          turn.stopReason !== 'awaiting_choice' ||
          turn.assistantMessageId !== assistantMessage.id
        ) {
          throw new Error(`AGENT_TURN_CHOICE_OFFER_REPLAY_DIVERGED:${params.offer.offerId}`)
        }
        return
      }
      if (
        turn.status !== 'running' ||
        turn.executionOwnerId !== params.executionOwnerId ||
        turn.modelHistoryBaseVersion !== params.input.modelHistory.version
      ) {
        throw new Error(`AGENT_TURN_CHOICE_FENCE_DIVERGED:${turn.id}:${turn.status}`)
      }
      await recordAgentTurnUsageFactsInTransaction({
        tx,
        turnId: turn.id,
        attempt: turn.attempt,
        projectId: turn.projectId,
        userId: turn.userId,
        usageFacts: params.usageFacts,
      })
      await commitProjectAssistantTurnInTransaction(tx, {
        threadId: turn.threadId,
        projectId: turn.projectId,
        userId: turn.userId,
        episodeId: turn.episodeId,
        assistantId: 'workspace-command',
        expectedModelHistoryVersion: params.input.modelHistory.version,
        messages: [assistantMessage],
        modelHistoryItems: params.modelHistoryItems,
      })
      await tx.agentTurnInteraction.create({
        data: {
          id: params.offer.offerId,
          turnId: turn.id,
          kind: 'choice',
          status: 'pending',
          payloadJson,
          runState: null,
        },
      })
      await tx.agentTurnInteraction.updateMany({
        where: {
          turnId: turn.id,
          kind: 'approval',
          status: { in: ['approved', 'rejected'] },
          runState: { not: null },
        },
        data: { runState: null },
      })
      await tx.projectAgentTurn.update({
        where: { id: turn.id },
        data: {
          status: 'completed',
          assistantMessageId: assistantMessage.id,
          stopReason: 'awaiting_choice',
          modelHistoryBaseVersion: params.input.modelHistory.version + 1,
          finishedAt: new Date(),
        },
      })
    },
    {
      maxWait: 10_000,
      timeout: 30_000,
    },
  )
}

export async function resolveAgentTurnChoice(
  command: ResolveAgentTurnChoiceCommand,
): Promise<ResolvedAgentTurnChoice> {
  if (command.protocol !== 'agent_turn_choice_response_v1') {
    throw new Error('AGENT_TURN_CHOICE_RESPONSE_PROTOCOL_INVALID')
  }
  requireIdentity(command.threadId, 'AGENT_TURN_CHOICE_THREAD_ID_INVALID')
  requireIdentity(command.offerId, 'AGENT_TURN_CHOICE_OFFER_ID_INVALID')
  requireIdentity(command.projectId, 'AGENT_TURN_CHOICE_PROJECT_ID_INVALID')
  requireIdentity(command.userId, 'AGENT_TURN_CHOICE_USER_ID_INVALID')
  requireIdentity(command.requestId, 'AGENT_TURN_CHOICE_REQUEST_ID_INVALID', 128)
  const identity = await prisma.agentTurnInteraction.findUnique({
    where: { id: command.offerId },
    select: {
      turnId: true,
      turn: {
        select: {
          threadId: true,
          projectId: true,
          userId: true,
          contextJson: true,
          episodeId: true,
        },
      },
    },
  })
  if (
    !identity ||
    identity.turn.threadId !== command.threadId ||
    identity.turn.projectId !== command.projectId ||
    identity.turn.userId !== command.userId
  ) {
    throw new Error(`AGENT_TURN_CHOICE_SCOPE_DIVERGED:${command.offerId}`)
  }
  const settled = await prisma.$transaction(
    async (tx) => {
      const projects = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM projects
      WHERE id = ${command.projectId}
      FOR UPDATE
    `)
      if (projects.length !== 1) {
        throw new Error(`AGENT_TURN_CHOICE_PROJECT_NOT_FOUND:${command.projectId}`)
      }
      const threads = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM project_assistant_threads
      WHERE id = ${command.threadId}
      FOR UPDATE
    `)
      if (threads.length !== 1) {
        throw new Error(`AGENT_TURN_CHOICE_THREAD_NOT_FOUND:${command.threadId}`)
      }
      const turns = await tx.$queryRaw<ProjectAgentTurn[]>(Prisma.sql`
      SELECT *
      FROM project_agent_turns
      WHERE id = ${identity.turnId}
      FOR UPDATE
    `)
      const turn = turns[0] ?? null
      const interactions = await tx.$queryRaw<
        Array<{
          id: string
          turnId: string
          kind: string
          status: string
          payloadJson: Prisma.JsonValue
          responseJson: Prisma.JsonValue | null
          version: number
        }>
      >(Prisma.sql`
      SELECT id, turnId, kind, status, payloadJson, responseJson, version
      FROM agent_turn_interactions
      WHERE id = ${command.offerId}
      FOR UPDATE
    `)
      const interaction = interactions[0] ?? null
      if (
        !turn ||
        !interaction ||
        turn.threadId !== command.threadId ||
        turn.projectId !== command.projectId ||
        turn.userId !== command.userId ||
        interaction.turnId !== turn.id ||
        interaction.kind !== 'choice'
      ) {
        throw new Error(`AGENT_TURN_CHOICE_SCOPE_DIVERGED:${command.offerId}`)
      }
      const turnContext = parseContext(turn.contextJson)
      const offer = parseAgentTurnChoiceOfferPayload(interaction.payloadJson)
      const choiceOffer = toProjectAgentChoiceOffer(offer)
      const decision = parseProjectAgentChoiceDecision({
        offer: choiceOffer,
        response: command.response,
      })
      const visibleUserText = buildCanonicalChoiceVisibleUserText({
        card: offer.card,
        decision,
        context: turnContext,
      })
      const responseJson = toJson({
        protocol: 'agent_turn_choice_response_v1',
        requestId: command.requestId,
        response: command.response,
        decision,
        visibleUserText,
      })
      const commitment = resolveProjectAgentChoiceCommitment({
        offer: choiceOffer,
        decision,
      })
      const registry = createProjectAgentOperationRegistry()
      const commitmentOperation = commitment ? registry[commitment.operationId] : null
      const mutationReceipt = commitmentOperation
        ? projectOperationMutationReceipt({
            operation: commitmentOperation,
            projectId: turn.projectId,
            episodeId: turn.episodeId,
          })
        : null
      if (interaction.status === 'resolved') {
        if (!isDeepStrictEqual(interaction.responseJson, responseJson)) {
          throw new Error(`AGENT_TURN_CHOICE_RESPONSE_REPLAY_DIVERGED:${interaction.id}`)
        }
      } else {
        if (interaction.status !== 'pending' || interaction.version !== 0) {
          throw new Error(
            `AGENT_TURN_CHOICE_RESPONSE_REJECTED:${interaction.id}:${interaction.status}`,
          )
        }
        await assertProjectAgentChoiceOfferCurrent({
          tx,
          projectId: turn.projectId,
          userId: turn.userId,
          episodeId: turn.episodeId,
          offer: choiceOffer,
        })
        if (commitment) {
          const result = await invokeProjectAgentOperation({
            registry,
            channel: 'tool',
            operationId: commitment.operationId,
            context: {
              request: null,
              requestId: command.requestId,
              userId: turn.userId,
              projectId: turn.projectId,
              context: {
                ...(turnContext.locale ? { locale: turnContext.locale } : {}),
                episodeId: turnContext.episodeId,
                selectedScopeRef: turnContext.selectedScopeRef,
                selectedAssetId: turnContext.selectedAssetId,
                turnId: turn.id,
                choiceDecision: decision,
              },
              invocationChannel: 'tool',
              source: 'assistant-choice',
              writer: null,
              toolCallId: offer.callId,
            },
            input: commitment.input,
            transaction: tx,
            invocationMode: 'atomic_choice_commit',
          })
          if (result.kind !== 'executed') {
            throw new Error(`AGENT_TURN_CHOICE_COMMIT_RESULT_INVALID:${commitment.operationId}`)
          }
        }
        await appendProjectAssistantThreadMessagesInTransaction(tx, {
          projectId: turn.projectId,
          userId: turn.userId,
          episodeId: turn.episodeId,
          assistantId: 'workspace-command',
          messages: [
            buildChoiceResponseMessage({
              offerId: offer.offerId,
              visibleUserText,
            }),
          ],
        })
        await tx.agentTurnInteraction.update({
          where: { id: interaction.id },
          data: {
            status: 'resolved',
            responseJson,
            version: { increment: 1 },
            resolvedAt: new Date(),
          },
        })
      }
      return {
        resolution: {
          offerId: offer.offerId,
          threadId: turn.threadId,
          originalTurnId: turn.id,
          projectId: turn.projectId,
          userId: turn.userId,
          requestId: command.requestId,
          visibleUserText,
          decision,
          callId: offer.callId,
          cardId: offer.card.cardId,
          context: turnContext,
        },
        mutationReceipt,
      }
    },
    {
      maxWait: 10_000,
      timeout: 30_000,
    },
  )
  await publishOperationMutationReceipt({
    projectId: settled.resolution.projectId,
    userId: settled.resolution.userId,
    receipt: settled.mutationReceipt,
  })
  return settled.resolution
}

export async function loadResolvedAgentTurnChoiceInput(params: {
  turnId: string
  offerId: string
}): Promise<AgentInputItem> {
  const interaction = await prisma.agentTurnInteraction.findUnique({
    where: { id: params.offerId },
    select: {
      turnId: true,
      kind: true,
      status: true,
      payloadJson: true,
      responseJson: true,
      turn: {
        select: { threadId: true, contextJson: true },
      },
    },
  })
  const turn = await prisma.projectAgentTurn.findUnique({
    where: { id: params.turnId },
    select: { threadId: true, sourceKind: true, sourceId: true },
  })
  if (
    !interaction ||
    !turn ||
    interaction.kind !== 'choice' ||
    interaction.status !== 'resolved' ||
    interaction.turn.threadId !== turn.threadId ||
    turn.sourceKind !== 'choice_response' ||
    turn.sourceId !== params.offerId
  ) {
    throw new Error(`AGENT_TURN_CHOICE_INPUT_NOT_READY:${params.turnId}:${params.offerId}`)
  }
  const offer = parseAgentTurnChoiceOfferPayload(interaction.payloadJson)
  if (
    !interaction.responseJson ||
    typeof interaction.responseJson !== 'object' ||
    Array.isArray(interaction.responseJson)
  ) {
    throw new Error('AGENT_TURN_CHOICE_RESPONSE_INVALID')
  }
  const response = interaction.responseJson as Record<string, unknown>
  const storedVisibleUserText = requireVisibleUserText(String(response.visibleUserText ?? ''))
  const decision = parseProjectAgentChoiceDecision({
    offer: toProjectAgentChoiceOffer(offer),
    response: response.response,
  })
  const visibleUserText = buildCanonicalChoiceVisibleUserText({
    card: offer.card,
    decision,
    context: parseContext(interaction.turn.contextJson),
  })
  if (visibleUserText !== storedVisibleUserText) {
    throw new Error('AGENT_TURN_CHOICE_VISIBLE_USER_TEXT_DIVERGED')
  }
  return buildProjectAgentChoiceResponseInputItem({
    decision,
    toolCallId: offer.callId,
    cardId: offer.card.cardId,
    visibleUserText,
  })
}
