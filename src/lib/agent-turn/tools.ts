import { tool, type Tool } from '@openai/agents'
import { buildToolError, normalizeOperationExecutionToolError } from '@/lib/adapters/operation-error-normalizer'
import {
  buildAgentToolEffectInputHash,
  executeAgentToolEffectTransaction,
} from '@/lib/agent-turn/tool-effect'
import {
  buildDirectOperationInvocationIdentity,
  executeApprovedTaskOperationViaTemporal,
  executeDirectTaskOperationViaTemporal,
} from '@/lib/operations/durable-dispatch'
import { invokeProjectAgentOperation } from '@/lib/operations/invocation'
import { parseOperationMutationReceipt } from '@/lib/operations/mutation-receipt'
import type { PlannedOperationInvocation } from '@/lib/operations/planned-operation-invocation'
import {
  isBillablePlannedOperation,
  type ProjectAgentOperationContext,
  type ProjectAgentOperationDefinition,
  type OperationMutationReceipt,
  type ProjectAgentOperationRegistry,
  type ProjectAgentToolResult,
} from '@/lib/operations/types'
import { publishOperationMutationReceipt } from '@/lib/workspace-resource/resource-change-publisher'
import {
  PROJECT_AGENT_OPERATION_GATEWAY_INPUT_SCHEMA,
  PROJECT_AGENT_OPERATION_GATEWAY_NAME,
  readProjectAgentOperationGatewayInput,
  resolveProjectAgentOperationGatewayToolIdentity,
} from '@/lib/project-agent/tool-discovery'
import type { AgentTurnContextSnapshot } from './contracts'
import type { PreparedAgentTurnChoiceOffer } from './choice'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readCallId(details: unknown): string {
  if (!isRecord(details) || !isRecord(details.toolCall)) {
    throw new Error('AGENT_TURN_TOOL_CALL_ID_MISSING')
  }
  const callId = typeof details.toolCall.callId === 'string'
    ? details.toolCall.callId.trim()
    : ''
  if (!callId) throw new Error('AGENT_TURN_TOOL_CALL_ID_MISSING')
  return callId
}

function failedResult(
  operationId: string,
  error: unknown,
  operation?: ProjectAgentOperationDefinition,
): Extract<ProjectAgentToolResult<unknown>, { ok: false }> {
  return {
    ok: false,
    error: normalizeOperationExecutionToolError({
      error,
      operation: operation ?? {},
      operationId,
    }),
  }
}

function confirmationRequired(
  operationId: string,
): ProjectAgentToolResult<unknown> {
  return {
    ok: false,
    confirmationRequired: true,
    error: buildToolError({
      code: 'CONFIRMATION_REQUIRED',
      message: 'PROJECT_AGENT_OPERATION_APPROVAL_REQUIRED',
      operationId,
    }),
  }
}

interface StoredEffectResult {
  data: unknown
  mutationReceipt: OperationMutationReceipt | null
}

function parseStoredEffectResult(value: unknown): StoredEffectResult {
  if (!isRecord(value) || !('data' in value)) {
    throw new Error('AGENT_TOOL_EFFECT_RESULT_INVALID')
  }
  return {
    data: value.data,
    mutationReceipt: parseOperationMutationReceipt(
      Object.prototype.hasOwnProperty.call(value, 'mutationReceipt')
        ? value.mutationReceipt
        : null,
    ),
  }
}

export interface CreateAgentTurnOperationToolsParams {
  registry: ProjectAgentOperationRegistry
  description: string
  directOperations: readonly {
    operation: ProjectAgentOperationDefinition
    description: string
  }[]
  turnId: string
  executionOwnerId: string
  requestId: string
  projectId: string
  userId: string
  context: AgentTurnContextSnapshot
  userTurnText: string | null
  userTurnMediaResourceIds: readonly string[]
  signal: AbortSignal
  source: string
  approvedInvocationByCallId?: Readonly<Record<string, PlannedOperationInvocation>>
  authorizeBillableAutomatically?: (params: {
    operation: ProjectAgentOperationDefinition
    input: unknown
    callId: string
  }) => Promise<PlannedOperationInvocation>
  onToolCallIdentified?: (identity: {
    callId: string
    operationId: string
  }) => void
  onChoiceOfferPrepared?: (
    offer: PreparedAgentTurnChoiceOffer,
  ) => void
}

/**
 * Thin B+ tool transport. It contains no Run, lock, Wait, Handoff, Activity
 * projection, or HTTP Request. Domain semantics stay in the Operation registry.
 */
export function createAgentTurnOperationTools<Context>(
  params: CreateAgentTurnOperationToolsParams,
): Tool<Context>[] {
  const directOperationByCallId = new Map<string, string>()
  let terminalChoiceCallId: string | null = null

  const identify = (callId: string, operationId: string): void => {
    const existing = directOperationByCallId.get(callId)
    if (existing && existing !== operationId) {
      throw new Error(
        `AGENT_TURN_TOOL_CALL_ID_DIVERGED:${callId}:${existing}:${operationId}`,
      )
    }
    directOperationByCallId.set(callId, operationId)
    params.onToolCallIdentified?.({ callId, operationId })
  }

  const operationContext = (
    callId: string,
    choiceOfferWriter?: NonNullable<
      ProjectAgentOperationContext['choiceOfferWriter']
    >,
  ): ProjectAgentOperationContext => ({
    request: null,
    requestId: params.requestId,
    signal: params.signal,
    userId: params.userId,
    projectId: params.projectId,
    context: {
      ...(params.context.locale ? { locale: params.context.locale } : {}),
      episodeId: params.context.episodeId,
      turnId: params.turnId,
      userTurnText: params.userTurnText,
      userTurnMediaResourceIds: params.userTurnMediaResourceIds,
      selectedScopeRef: params.context.selectedScopeRef,
      selectedAssetId: params.context.selectedAssetId,
    },
    invocationChannel: 'tool' as const,
    source: params.source,
    writer: null,
    toolCallId: callId,
    activityId: null,
    ...(choiceOfferWriter ? { choiceOfferWriter } : {}),
  })

  const executeOperation = async (
    operation: ProjectAgentOperationDefinition,
    input: unknown,
    callId: string,
  ): Promise<ProjectAgentToolResult<unknown>> => {
    identify(callId, operation.id)
    try {
      if (terminalChoiceCallId && terminalChoiceCallId !== callId) {
        throw new Error(
          `AGENT_TURN_TOOL_AFTER_CHOICE_FORBIDDEN:${terminalChoiceCallId}:${callId}`,
        )
      }
      if (operation.agentFlow?.suspendsFor === 'choice') {
        const prepared: { value: PreparedAgentTurnChoiceOffer | null } = {
          value: null,
        }
        const result = await invokeProjectAgentOperation({
          registry: params.registry,
          channel: 'tool',
          operationId: operation.id,
          context: operationContext(callId, async (offer) => {
            if (
              offer.operationId !== operation.id
              || offer.callId !== callId
              || offer.card.toolCallId !== callId
              || prepared.value
            ) {
              throw new Error(
                `AGENT_TURN_CHOICE_OFFER_DIVERGED:${operation.id}:${callId}`,
              )
            }
            prepared.value = {
              protocol: 'agent_turn_choice_offer_v1',
              offerId: offer.card.cardId,
              operationId: offer.operationId,
              callId: offer.callId,
              card: offer.card,
              subject: offer.subject,
              commitments: offer.commitments,
              modelArguments: offer.modelArguments,
            }
            return { offerId: offer.card.cardId }
          }),
          input,
        })
        if (result.kind !== 'executed' || !prepared.value) {
          throw new Error(
            `AGENT_TURN_CHOICE_OFFER_MISSING:${operation.id}:${callId}`,
          )
        }
        terminalChoiceCallId = callId
        params.onChoiceOfferPrepared?.(prepared.value)
        return { ok: true, data: result.data }
      }
      let approvedInvocation =
        params.approvedInvocationByCallId?.[callId] ?? null
      if (isBillablePlannedOperation(operation)) {
        if (!approvedInvocation && params.authorizeBillableAutomatically) {
          approvedInvocation =
            await params.authorizeBillableAutomatically({
              operation,
              input,
              callId,
            })
        }
        if (!approvedInvocation) return confirmationRequired(operation.id)
        const result = await executeApprovedTaskOperationViaTemporal({
          registry: params.registry,
          operationId: operation.id,
          userId: params.userId,
          projectId: params.projectId,
          source: params.source,
          invocation: approvedInvocation,
          context: operationContext(callId).context,
          origin: {
            kind: 'agent_turn',
            turnId: params.turnId,
            callId,
          },
        })
        return { ok: true, data: result.data }
      }
      if (
        operation.assistantWriteAuthority?.kind
          === 'temporal_operation_execution'
      ) {
        const identity = buildDirectOperationInvocationIdentity({
          channel: 'tool',
          projectId: params.projectId,
          operationId: operation.id,
          stableSourceId: JSON.stringify([params.turnId, callId]),
        })
        const result = await executeDirectTaskOperationViaTemporal({
          registry: params.registry,
          channel: 'tool',
          operationId: operation.id,
          userId: params.userId,
          projectId: params.projectId,
          source: params.source,
          context: operationContext(callId).context,
          input,
          ...identity,
          origin: {
            kind: 'agent_turn',
            turnId: params.turnId,
            callId,
          },
        })
        return { ok: true, data: result.data }
      }
      if (operation.effects.writes) {
        const contractRevision = operation.toolContractRevision
        if (!contractRevision) {
          throw new Error(
            `AGENT_TOOL_EFFECT_CONTRACT_REVISION_MISSING:${operation.id}`,
          )
        }
        const stored = parseStoredEffectResult(
          await executeAgentToolEffectTransaction({
            turnId: params.turnId,
            executionOwnerId: params.executionOwnerId,
            callId,
            operationId: operation.id,
            contractRevision,
            inputHash: buildAgentToolEffectInputHash({
              operationId: operation.id,
              contractRevision,
              input,
            }),
            execute: async (tx) => {
              const result = await invokeProjectAgentOperation({
                registry: params.registry,
                channel: 'tool',
                operationId: operation.id,
                context: operationContext(callId),
                input,
                transaction: tx,
                invocationMode: 'agent_tool_effect',
              })
              if (result.kind !== 'executed') {
                throw new Error(
                  `AGENT_TOOL_EFFECT_RESULT_KIND_INVALID:${operation.id}`,
                )
              }
              return {
                data: result.data,
                mutationReceipt: result.mutationReceipt,
              } satisfies StoredEffectResult
            },
          }),
        )
        await publishOperationMutationReceipt({
          projectId: params.projectId,
          userId: params.userId,
          receipt: stored.mutationReceipt,
        })
        return { ok: true, data: stored.data }
      }
      const result = await invokeProjectAgentOperation({
        registry: params.registry,
        channel: 'tool',
        operationId: operation.id,
        context: operationContext(callId),
        input,
      })
      return { ok: true, data: result.data }
    } catch (error) {
      return failedResult(operation.id, error, operation)
    }
  }

  const needsApproval = async (
    operation: ProjectAgentOperationDefinition,
    callId: string,
  ): Promise<boolean> => {
    identify(callId, operation.id)
    if (params.approvedInvocationByCallId?.[callId]) return false
    return (
      operation.confirmation.kind === 'billable_media'
      && !params.authorizeBillableAutomatically
    )
      || operation.confirmation.kind === 'destructive'
  }

  const gateway = tool({
    name: PROJECT_AGENT_OPERATION_GATEWAY_NAME,
    description: params.description,
    parameters: PROJECT_AGENT_OPERATION_GATEWAY_INPUT_SCHEMA as never,
    strict: true,
    needsApproval: async (
      _runContext: unknown,
      input: unknown,
      callId?: string,
    ) => {
      const invocation = readProjectAgentOperationGatewayInput(input)
      const operation = params.registry[invocation.operationId]
      if (!operation?.channels.tool) return false
      if (!callId?.trim()) throw new Error('AGENT_TURN_TOOL_CALL_ID_MISSING')
      return await needsApproval(operation, callId.trim())
    },
    execute: async (
      input: unknown,
      _runContext: unknown,
      details: unknown,
    ) => {
      const callId = readCallId(details)
      let operationId = resolveProjectAgentOperationGatewayToolIdentity(input)
      try {
        const invocation = readProjectAgentOperationGatewayInput(input)
        operationId = invocation.operationId
        const operation = params.registry[operationId]
        if (!operation?.channels.tool) {
          throw new Error(
            `PROJECT_AGENT_OPERATION_GATEWAY_OPERATION_UNKNOWN:${operationId}`,
          )
        }
        if (
          operation.toolExposure === 'direct'
          && directOperationByCallId.get(callId) !== operation.id
        ) {
          throw new Error(
            `PROJECT_AGENT_OPERATION_DIRECT_TOOL_REQUIRED:${operation.id}`,
          )
        }
        return await executeOperation(operation, invocation.arguments, callId)
      } catch (error) {
        return failedResult(operationId, error, params.registry[operationId])
      }
    },
  }) as Tool<Context>

  const directTools = params.directOperations.map((entry) => tool({
    name: entry.operation.id,
    description: entry.description,
    parameters: entry.operation.toolInputSchema as never,
    strict: true,
    needsApproval: async (
      _runContext: unknown,
      _input: unknown,
      callId?: string,
    ) => {
      if (!callId?.trim()) throw new Error('AGENT_TURN_TOOL_CALL_ID_MISSING')
      return await needsApproval(entry.operation, callId.trim())
    },
    execute: async (
      input: unknown,
      _runContext: unknown,
      details: unknown,
    ) => {
      const callId = readCallId(details)
      identify(callId, entry.operation.id)
      return await executeOperation(entry.operation, input, callId)
    },
  }) as Tool<Context>)

  return [gateway, ...directTools]
}
