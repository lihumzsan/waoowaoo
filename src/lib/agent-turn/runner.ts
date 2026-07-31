import {
  Agent,
  RunContext,
  RunState,
  Runner,
  type AgentInputItem,
  type RunStreamEvent,
  type RunToolApprovalItem,
  type Tool,
} from '@openai/agents'
import { aisdk } from '@openai/agents-extensions/ai-sdk'
import { readUIMessageStream, type UIMessage } from 'ai'
import { buildAiExecutionSessionId } from '@/lib/ai-exec/session'
import { ensureAgentsLocalTracing } from '@/lib/ai-exec/agents-tracing'
import { readAssistantBillingConfirmationRequired } from '@/lib/project-agent/billing-confirmation'
import { measureProjectAgentToolSchemas } from '@/lib/project-agent/context-telemetry'
import { normalizeProjectAgentLocale } from '@/lib/project-agent/locale'
import {
  assertProjectAgentModelInputWithinBudget,
  decideProjectAgentModelInput,
  prepareProjectAgentContextCompressionInput,
} from '@/lib/project-agent/model-input/filter'
import { compressProjectAgentContext } from '@/lib/project-agent/model-input/compaction'
import { estimateProjectAgentTokens } from '@/lib/project-agent/model-input/estimate'
import {
  resolveProjectAgentAssistantModelKey,
  resolveProjectAgentLanguageModel,
} from '@/lib/project-agent/model'
import { resolveProjectAssistantModelInputMedia } from '@/lib/project-agent/media-attachments/model-input-runtime'
import { readProjectAgentPlan } from '@/lib/project-agent/plan'
import {
  createProjectAgentSideChannel,
  createProjectAgentUiMessageStream,
  type ProjectAgentUiChunk,
} from '@/lib/project-agent/agents-ui-stream'
import { buildProjectAgentSystemPrompt } from '@/lib/project-agent/system-prompt'
import {
  PROJECT_AGENT_OPERATION_GATEWAY_NAME,
  PROJECT_AGENT_TOOL_DISCOVERY_NAME,
  buildProjectAgentOperationGatewayDescription,
  createProjectAgentToolCatalog,
  createProjectAgentToolDiscoveryState,
  createProjectAgentToolDiscoveryTool,
  formatProjectAgentToolNotFound,
  readProjectAgentOperationGatewayOperationId,
} from '@/lib/project-agent/tool-discovery'
import { resolveProjectAgentToolset } from '@/lib/project-agent/toolset'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import { hashCanonicalJson } from '@/lib/operation-plan-contract/canonical-json'
import {
  AGENT_TURN_SOURCE_KIND,
  type AgentTurnExecutionInput,
} from './contracts'
import { AgentTurnModelSession } from './model-session'
import {
  buildAgentTurnPlanInputItem,
  buildAgentTurnProjectStateInput,
  buildAgentTurnUserInputItem,
} from './runner-input'
import { createAgentTurnOperationTools } from './tools'
import { deriveAgentTurnUserEvidence } from './user-evidence'
import {
  authorizeAgentTurnOperationAutomatically,
  type AgentTurnApprovalResume,
} from './approval'
import {
  loadResolvedAgentTurnChoiceInput,
  type PreparedAgentTurnChoiceOffer,
} from './choice'
import { loadAgentTurnFollowUpInput } from './follow-up-batch'
import {
  loadInterruptedTurnEffectDigestInput,
} from './interrupted-effect-digest'
import { buildAgentTurnAssistantMessageId } from './stream-publisher'

ensureAgentsLocalTracing()

const AGENT_TURN_MAX_MODEL_TURNS = 12

interface AgentTurnRunContext {
  requestId: string
  projectId: string
  userId: string
  locale: string
}

export interface AgentTurnApprovalRequest {
  approvalId: string
  callId: string
  operationId: string
  input: unknown
  inputHash: string
}

export type AgentTurnRunnerResult =
  | {
      status: 'completed'
      assistantMessage: UIMessage
      modelHistoryItems: AgentInputItem[]
      stopReason: 'completed'
    }
  | {
      status: 'waiting_approval'
      assistantMessage: UIMessage
      modelHistoryItems: AgentInputItem[]
      runState: string
      approvals: readonly AgentTurnApprovalRequest[]
    }
  | {
      status: 'waiting_choice'
      assistantMessage: UIMessage
      modelHistoryItems: AgentInputItem[]
      offer: PreparedAgentTurnChoiceOffer
    }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function requireUserMessage(message: UIMessage | null): UIMessage {
  if (!message) throw new Error('AGENT_TURN_USER_MESSAGE_REQUIRED')
  return message
}

function readApprovalString(
  item: RunToolApprovalItem,
  key: string,
): string | null {
  const rawItem: unknown = item.rawItem
  if (!isRecord(rawItem)) return null
  const value = rawItem[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readApprovalInput(item: RunToolApprovalItem): unknown {
  const rawItem: unknown = item.rawItem
  if (!isRecord(rawItem)) {
    throw new Error('AGENT_TURN_APPROVAL_RAW_ITEM_INVALID')
  }
  for (const candidate of [rawItem.arguments, rawItem.args, rawItem.input]) {
    if (isRecord(candidate)) return candidate
    if (typeof candidate === 'string' && candidate.trim()) {
      const parsed: unknown = JSON.parse(candidate)
      if (isRecord(parsed)) return parsed
    }
  }
  throw new Error('AGENT_TURN_APPROVAL_INPUT_INVALID')
}

function buildApprovalRequests(params: {
  items: readonly RunToolApprovalItem[]
  operationIdByCallId: ReadonlyMap<string, string>
}): AgentTurnApprovalRequest[] {
  const requests = params.items.map((item) => {
    const callId =
      readApprovalString(item, 'callId') ?? readApprovalString(item, 'id')
    if (!callId) throw new Error('AGENT_TURN_APPROVAL_CALL_ID_MISSING')
    const approvalId = readApprovalString(item, 'id') ?? callId
    const operationId = params.operationIdByCallId.get(callId)
    if (!operationId) {
      throw new Error(`AGENT_TURN_APPROVAL_OPERATION_MISSING:${callId}`)
    }
    const input = readApprovalInput(item)
    return {
      approvalId,
      callId,
      operationId,
      input,
      inputHash: hashCanonicalJson(input),
    }
  })
  if (new Set(requests.map((item) => item.callId)).size !== requests.length) {
    throw new Error('AGENT_TURN_APPROVAL_CALL_ID_DUPLICATE')
  }
  if (
    new Set(requests.map((item) => item.approvalId)).size !== requests.length
  ) {
    throw new Error('AGENT_TURN_APPROVAL_ID_DUPLICATE')
  }
  return requests
}

async function consumeUiMessage(params: {
  turnId: string
  attempt: number
  stream: ReadableStream<ProjectAgentUiChunk>
}): Promise<UIMessage> {
  if (!Number.isSafeInteger(params.attempt) || params.attempt <= 0) {
    throw new Error('AGENT_TURN_ATTEMPT_INVALID')
  }
  const messageId = buildAgentTurnAssistantMessageId(params)
  let latest: UIMessage | null = null
  for await (const message of readUIMessageStream({
    stream: params.stream,
    terminateOnError: true,
    message: {
      id: messageId,
      role: 'assistant',
      parts: [],
    },
  })) {
    latest = message
  }
  if (!latest || latest.parts.length === 0) {
    throw new Error('AGENT_TURN_ASSISTANT_MESSAGE_EMPTY')
  }
  return latest
}

function identifyOperationFromEvent(params: {
  event: RunStreamEvent
  directOperationIds: readonly string[]
}): { callId: string; operationId: string } | null {
  const event = params.event
  if (
    event.type !== 'run_item_stream_event' ||
    event.name !== 'tool_called' ||
    event.item.type !== 'tool_call_item' ||
    event.item.rawItem.type !== 'function_call'
  ) {
    return null
  }
  const operationId =
    event.item.rawItem.name === PROJECT_AGENT_OPERATION_GATEWAY_NAME
      ? readProjectAgentOperationGatewayOperationId(
          JSON.parse(event.item.rawItem.arguments) as unknown,
        )
      : params.directOperationIds.includes(event.item.rawItem.name)
        ? event.item.rawItem.name
        : null
  return operationId
    ? {
        callId: event.item.rawItem.callId,
        operationId,
      }
    : null
}

export async function runAgentTurn(params: {
  input: AgentTurnExecutionInput
  executionOwnerId: string
  signal: AbortSignal
  publishUiChunk: (chunk: ProjectAgentUiChunk) => void
  approvalResume?: AgentTurnApprovalResume | null
}): Promise<AgentTurnRunnerResult> {
  const { input } = params
  const approvalResume = params.approvalResume ?? null
  if (input.turn.sourceKind === AGENT_TURN_SOURCE_KIND.USER) {
    if (!input.userMessage) {
      throw new Error('AGENT_TURN_USER_MESSAGE_REQUIRED')
    }
  } else if (
    input.turn.sourceKind === AGENT_TURN_SOURCE_KIND.CHOICE_RESPONSE ||
    input.turn.sourceKind === AGENT_TURN_SOURCE_KIND.TASK_FOLLOW_UP
  ) {
    if (input.userMessage) {
      throw new Error('AGENT_TURN_DERIVED_USER_MESSAGE_FORBIDDEN')
    }
  } else {
    throw new Error(
      `AGENT_TURN_SOURCE_RUNNER_NOT_INSTALLED:${input.turn.sourceKind}`,
    )
  }
  params.signal.throwIfAborted()
  const locale = normalizeProjectAgentLocale(input.context.locale)
  const [
    assistantModelKey,
    billingConfirmationRequired,
    projectState,
    plan,
    interruptedEffectDigest,
  ] = await Promise.all([
      resolveProjectAgentAssistantModelKey(input.turn.userId),
      readAssistantBillingConfirmationRequired(input.turn.userId),
      buildAgentTurnProjectStateInput({
        projectId: input.turn.projectId,
        userId: input.turn.userId,
        episodeId: input.context.episodeId,
      }),
      readProjectAgentPlan({
        projectId: input.turn.projectId,
        userId: input.turn.userId,
        episodeId: input.context.episodeId,
        assistantId: 'workspace-command',
      }),
      approvalResume
        ? Promise.resolve(null)
        : loadInterruptedTurnEffectDigestInput(input.turn.id),
    ])
  const openRouterSessionId = buildAiExecutionSessionId({
    kind: 'project-agent',
    userId: input.turn.userId,
    projectId: input.turn.projectId,
    episodeId: input.context.episodeId,
    assistantId: 'workspace-command',
    modelKey: assistantModelKey,
  })
  const resolved = await resolveProjectAgentLanguageModel({
    userId: input.turn.userId,
    modelKey: assistantModelKey,
    reasoningPurpose: 'assistant',
    promptCacheHorizon: 'conversation',
    openRouterSessionId,
  })
  const registry = createProjectAgentOperationRegistry()
  const toolset = resolveProjectAgentToolset({
    registry,
    disabledOperationIds: [],
  })
  const catalog = createProjectAgentToolCatalog({ registry, toolset })
  const discovery = createProjectAgentToolDiscoveryState({ catalog })
  const operationIdByCallId = new Map<string, string>()
  const preparedChoice: { value: PreparedAgentTurnChoiceOffer | null } = {
    value: null,
  }
  const userEvidence = deriveAgentTurnUserEvidence(input.userMessage)
  const operationTools = createAgentTurnOperationTools<AgentTurnRunContext>({
    registry,
    description: buildProjectAgentOperationGatewayDescription(),
    directOperations: toolset.directOperationIds.map((operationId) => {
      const operation = registry[operationId]
      if (!operation) {
        throw new Error(`PROJECT_AGENT_OPERATION_NOT_FOUND:${operationId}`)
      }
      return {
        operation,
        description: operation.summary,
      }
    }),
    turnId: input.turn.id,
    executionOwnerId: params.executionOwnerId,
    requestId: input.turn.requestId,
    projectId: input.turn.projectId,
    userId: input.turn.userId,
    context: input.context,
    userTurnText: userEvidence.text,
    userTurnMediaResourceIds: userEvidence.mediaResourceIds,
    signal: params.signal,
    source: 'assistant-panel',
    ...(approvalResume
      ? {
          approvedInvocationByCallId: approvalResume.approvedInvocationByCallId,
        }
      : {}),
    ...(!billingConfirmationRequired
      ? {
          authorizeBillableAutomatically: async ({
            operation,
            input: operationInput,
            callId,
          }: {
            operation: (typeof registry)[string]
            input: unknown
            callId: string
          }) =>
            await authorizeAgentTurnOperationAutomatically({
              input,
              signal: params.signal,
              approval: {
                approvalId: `automatic:${callId}`,
                callId,
                operationId: operation.id,
                input: operationInput,
                inputHash: hashCanonicalJson(operationInput),
              },
            }),
        }
      : {}),
    onToolCallIdentified: ({ callId, operationId }) => {
      const existing = operationIdByCallId.get(callId)
      if (existing && existing !== operationId) {
        throw new Error(
          `AGENT_TURN_TOOL_IDENTITY_DIVERGED:${callId}:${existing}:${operationId}`,
        )
      }
      operationIdByCallId.set(callId, operationId)
    },
    onChoiceOfferPrepared: (offer) => {
      if (
        preparedChoice.value &&
        preparedChoice.value.offerId !== offer.offerId
      ) {
        throw new Error(
          `AGENT_TURN_MULTIPLE_CHOICE_OFFERS:${preparedChoice.value.offerId}:${offer.offerId}`,
        )
      }
      preparedChoice.value = offer
    },
  })
  const tools: Tool<AgentTurnRunContext>[] = [
    createProjectAgentToolDiscoveryTool<AgentTurnRunContext>({
      state: discovery,
    }),
    ...operationTools,
  ]
  const systemPrompt = buildProjectAgentSystemPrompt({
    projectId: input.turn.projectId,
    episodeId: input.context.episodeId || 'unknown',
  })
  const inputFilterConfig = {
    modelKey: assistantModelKey,
    toolSchemaTokens: estimateProjectAgentTokens(
      measureProjectAgentToolSchemas(tools),
    ),
    locale,
    irreplaceableToolNames: new Set(
      Object.values(registry)
        .filter(
          (operation) => operation.modelResultRetention === 'irreplaceable',
        )
        .map((operation) => operation.id),
    ),
  }
  const session = new AgentTurnModelSession(
    input.turn.id,
    input.modelHistory.items,
  )
  const sourceInput: AgentInputItem[] = approvalResume
    ? []
    : input.turn.sourceKind === AGENT_TURN_SOURCE_KIND.USER
      ? [buildAgentTurnUserInputItem(requireUserMessage(input.userMessage))]
      : input.turn.sourceKind === AGENT_TURN_SOURCE_KIND.CHOICE_RESPONSE
        ? [
            await loadResolvedAgentTurnChoiceInput({
              turnId: input.turn.id,
              offerId: input.turn.sourceId,
            }),
          ]
        : [
            await loadAgentTurnFollowUpInput({
              turnId: input.turn.id,
              batchId: input.turn.sourceId,
            }),
          ]
  const agentInput: AgentInputItem[] = approvalResume
    ? []
    : [
        ...(interruptedEffectDigest ? [interruptedEffectDigest] : []),
        ...sourceInput,
        projectState,
        ...(plan ? [buildAgentTurnPlanInputItem(plan)] : []),
      ]
  let history = await session.getItems()
  if (!approvalResume) {
    const initialDecision = decideProjectAgentModelInput(inputFilterConfig, {
      input: [...history, ...agentInput],
      instructions: systemPrompt,
    })
    if (initialDecision.overBudget) {
      const compaction = await compressProjectAgentContext({
        session,
        inputItems: prepareProjectAgentContextCompressionInput(
          inputFilterConfig,
          history,
          initialDecision.freedTokens,
        ),
        userId: input.turn.userId,
        signal: params.signal,
      })
      history = [...compaction.historyItems]
      assertProjectAgentModelInputWithinBudget(
        decideProjectAgentModelInput(inputFilterConfig, {
          input: [...history, ...agentInput],
          instructions: systemPrompt,
        }),
      )
    }
  }
  const runContext = new RunContext<AgentTurnRunContext>({
    requestId: input.turn.requestId,
    projectId: input.turn.projectId,
    userId: input.turn.userId,
    locale,
  })
  const agent = new Agent<AgentTurnRunContext>({
    name: 'Project Workspace Agent',
    instructions: systemPrompt,
    model: aisdk(
      resolved.languageModel as unknown as Parameters<typeof aisdk>[0],
    ),
    modelSettings: {
      parallelToolCalls: true,
    },
    tools,
    toolUseBehavior: () =>
      preparedChoice.value
        ? {
            isFinalOutput: true,
            isInterrupted: undefined,
            finalOutput: '',
          }
        : {
            isFinalOutput: false,
            isInterrupted: undefined,
          },
  })
  const runner = new Runner({
    workflowName: 'project-agent-turn',
    groupId: input.turn.id,
    traceMetadata: {
      projectId: input.turn.projectId,
      userId: input.turn.userId,
      threadId: input.turn.threadId,
      turnId: input.turn.id,
    },
  })
  const runInput = approvalResume
    ? await (async () => {
        const state = await RunState.fromStringWithContext<
          AgentTurnRunContext,
          Agent<AgentTurnRunContext>
        >(agent, approvalResume.runState, runContext, {
          contextStrategy: 'replace',
        })
        const interruptions = state.getInterruptions()
        if (interruptions.length !== approvalResume.members.length) {
          throw new Error(
            'AGENT_TURN_APPROVAL_STATE_MEMBER_COUNT_DIVERGED',
          )
        }
        const matchedInterruptions = new Set<RunToolApprovalItem>()
        for (const member of approvalResume.members) {
          const operation = registry[member.operationId]
          if (
            !operation?.channels.tool
            || !operation.confirmation.required
            || operation.toolContractRevision
              !== member.toolContractRevision
          ) {
            throw new Error(
              `AGENT_TURN_APPROVAL_TOOL_CONTRACT_DIVERGED:${member.operationId}`,
            )
          }
          const matches = interruptions.filter(
            (candidate) =>
              readApprovalString(candidate, 'callId') === member.callId
              && readApprovalString(candidate, 'id') === member.approvalId,
          )
          const interruption = matches[0]
          if (
            matches.length !== 1
            || !interruption
            || matchedInterruptions.has(interruption)
          ) {
            throw new Error(
              `AGENT_TURN_APPROVAL_STATE_MEMBER_MISSING:${member.callId}`,
            )
          }
          const currentInput = readApprovalInput(interruption)
          if (
            hashCanonicalJson(currentInput) !== member.inputHash
            || hashCanonicalJson(member.input) !== member.inputHash
          ) {
            throw new Error(
              `AGENT_TURN_APPROVAL_STATE_INPUT_DIVERGED:${member.callId}`,
            )
          }
          matchedInterruptions.add(interruption)
          operationIdByCallId.set(member.callId, member.operationId)
          if (approvalResume.decision === 'approve') {
            state.approve(interruption)
          } else {
            state.reject(interruption, {
              message:
                approvalResume.reason ?? 'PROJECT_AGENT_TOOL_APPROVAL_REJECTED',
            })
          }
        }
        return state
      })()
    : agentInput
  const result = await runner.run(agent, runInput, {
    stream: true,
    maxTurns: AGENT_TURN_MAX_MODEL_TURNS,
    context: runContext,
    session,
    toolNotFoundBehavior: 'return_error_to_model',
    toolErrorFormatter: ({ kind, toolName }) =>
      kind === 'tool_not_found'
        ? formatProjectAgentToolNotFound({ toolName, catalog })
        : undefined,
    toolExecution: { maxFunctionToolConcurrency: 1 },
    callModelInputFilter: async ({ modelData }) => {
      const decision = decideProjectAgentModelInput(
        inputFilterConfig,
        modelData,
      )
      assertProjectAgentModelInputWithinBudget(decision)
      return {
        input: await resolveProjectAssistantModelInputMedia({
          items: decision.input,
          userId: input.turn.userId,
          projectId: input.turn.projectId,
        }),
        ...(decision.instructions === undefined
          ? {}
          : { instructions: decision.instructions }),
      }
    },
    signal: params.signal,
  })
  const observedSource = (async function* (): AsyncGenerator<RunStreamEvent> {
    for await (const event of result) {
      const identity = identifyOperationFromEvent({
        event,
        directOperationIds: toolset.directOperationIds,
      })
      if (identity) {
        const existing = operationIdByCallId.get(identity.callId)
        if (existing && existing !== identity.operationId) {
          throw new Error(
            `AGENT_TURN_TOOL_IDENTITY_DIVERGED:${identity.callId}:${existing}:${identity.operationId}`,
          )
        }
        operationIdByCallId.set(identity.callId, identity.operationId)
      }
      yield event
    }
  })()
  const sideChannel = createProjectAgentSideChannel()
  const uiStream = createProjectAgentUiMessageStream({
    source: observedSource,
    initialChunks: [],
    resolveToolName: (callId) => operationIdByCallId.get(callId) ?? null,
    availableToolNames: tools.map((item) => item.name),
    hiddenToolNames: [PROJECT_AGENT_TOOL_DISCOVERY_NAME],
    aliasedToolNames: [PROJECT_AGENT_OPERATION_GATEWAY_NAME],
    sideChannel,
    beforeFinish: async () => [],
    onChunk: params.publishUiChunk,
    onSettled: async () => {},
  })
  const assistantMessage = await consumeUiMessage({
    turnId: input.turn.id,
    attempt: input.turn.attempt,
    stream: uiStream,
  })
  await result.completed
  const interruptions =
    result.interruptions.length > 0
      ? result.interruptions
      : result.state.getInterruptions()
  if (preparedChoice.value) {
    if (interruptions.length > 0) {
      throw new Error('AGENT_TURN_CHOICE_APPROVAL_AMBIGUOUS')
    }
    return {
      status: 'waiting_choice',
      assistantMessage,
      modelHistoryItems: session.snapshot(),
      offer: preparedChoice.value,
    }
  }
  if (interruptions.length > 0) {
    return {
      status: 'waiting_approval',
      assistantMessage,
      modelHistoryItems: session.snapshot(),
      runState: result.state.toString(),
      approvals: buildApprovalRequests({
        items: interruptions,
        operationIdByCallId,
      }),
    }
  }
  return {
    status: 'completed',
    assistantMessage,
    modelHistoryItems: session.snapshot(),
    stopReason: 'completed',
  }
}
