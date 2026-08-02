import { safeValidateUIMessages, type UIMessage } from 'ai'
import type {
  RuntimeJsonValue,
  RuntimeServerRequestResponse,
} from '@/lib/codex-runtime/runtime-adapter'
import type { ProjectAgentPlanSnapshot } from '@/lib/project-agent/plan'
import type { AssistantRuntimeScope } from './contracts'

export type AssistantRuntimeSessionViewScope = AssistantRuntimeScope & {
  readonly assistantId: 'workspace-command'
}

export type AssistantRuntimeSessionTurnView = {
  readonly turnId: string
  readonly requestId: string
  readonly sourceKind: 'user' | 'task_follow_up' | 'choice_response'
  readonly sourceId: string
  readonly status: 'queued' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'interrupted' | 'cancelled'
  readonly attempt: number
  readonly assistantMessageId: string | null
  readonly stopReason: string | null
  readonly errorCode: string | null
  readonly cancelReason: string | null
  readonly startedAt: string | null
  readonly finishedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export type AssistantRuntimePendingInteractionView = {
  readonly kind: 'runtime_request'
  readonly interactionId: string
  readonly turnId: string
  readonly version: number
  readonly runtimeRequestId: string
  readonly requestId: string | number
  readonly method: string
  readonly params: RuntimeJsonValue
  readonly response: RuntimeJsonValue | null
  readonly status: 'pending' | 'decided'
  readonly createdAt: string
}

export type AssistantRuntimeSessionView = {
  readonly protocol: 'assistant_runtime_session_view_v1'
  readonly scope: AssistantRuntimeSessionViewScope
  readonly thread: {
    readonly threadId: string
    readonly messages: readonly UIMessage[]
    readonly plan: ProjectAgentPlanSnapshot | null
    readonly createdAt: string
    readonly updatedAt: string
  } | null
  readonly currentTurn: AssistantRuntimeSessionTurnView | null
  readonly queuedTurns: readonly AssistantRuntimeSessionTurnView[]
  readonly recentTurns: readonly AssistantRuntimeSessionTurnView[]
  readonly pendingInteraction: AssistantRuntimePendingInteractionView | null
  readonly followUpBatches: readonly {
    readonly batchId: string
    readonly originTurnId: string
    readonly callId: string
    readonly operationId: string
    readonly status: 'pending' | 'ready' | 'notified' | 'cancelled'
    readonly notifiedTurnId: string | null
    readonly tasks: readonly {
      readonly taskId: string
      readonly operationId: string | null
      readonly taskType: string
      readonly targetType: string
      readonly targetId: string
      readonly status: string
      readonly terminal: boolean
      readonly errorCode: string | null
      readonly createdAt: string
      readonly finishedAt: string | null
    }[]
    readonly progress: {
      readonly total: number
      readonly terminal: number
      readonly failed: number
      readonly cancelled: number
    }
    readonly createdAt: string
    readonly readyAt: string | null
    readonly notifiedAt: string | null
    readonly cancelledAt: string | null
  }[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requireString(value: unknown, code: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(code)
  return value
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  code: string,
): void {
  const allowed = new Set(keys)
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error(code)
}

export const ASSISTANT_RUNTIME_APPROVAL_METHODS = [
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
] as const

export const ASSISTANT_RUNTIME_CHOICE_METHODS = [
  'item/tool/requestUserInput',
  'mcpServer/elicitation/request',
] as const

export function isAssistantRuntimeSupportedRequestMethod(method: string): boolean {
  return (ASSISTANT_RUNTIME_APPROVAL_METHODS as readonly string[]).includes(method)
    || (ASSISTANT_RUNTIME_CHOICE_METHODS as readonly string[]).includes(method)
}

export function isAssistantRuntimeApprovalRequest(
  interaction: AssistantRuntimePendingInteractionView | null,
): interaction is AssistantRuntimePendingInteractionView {
  return Boolean(interaction && (ASSISTANT_RUNTIME_APPROVAL_METHODS as readonly string[])
    .includes(interaction.method))
}

export function isAssistantRuntimeChoiceRequest(
  interaction: AssistantRuntimePendingInteractionView | null,
): interaction is AssistantRuntimePendingInteractionView {
  return Boolean(interaction && (ASSISTANT_RUNTIME_CHOICE_METHODS as readonly string[])
    .includes(interaction.method))
}

export type AssistantRuntimeUserInputQuestion = {
  readonly id: string
  readonly header: string
  readonly question: string
  readonly isOther: boolean
  readonly isSecret: boolean
  readonly options: readonly { readonly label: string; readonly description: string }[] | null
}

export function readAssistantRuntimeUserInputQuestions(
  interaction: AssistantRuntimePendingInteractionView,
): readonly AssistantRuntimeUserInputQuestion[] {
  if (interaction.method !== 'item/tool/requestUserInput' || !isRecord(interaction.params)) {
    throw new Error('ASSISTANT_RUNTIME_REQUEST_USER_INPUT_INVALID')
  }
  const questions = interaction.params.questions
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 3) {
    throw new Error('ASSISTANT_RUNTIME_REQUEST_USER_INPUT_INVALID')
  }
  const ids = new Set<string>()
  return questions.map((value): AssistantRuntimeUserInputQuestion => {
    if (!isRecord(value)) throw new Error('ASSISTANT_RUNTIME_REQUEST_USER_INPUT_INVALID')
    const id = requireString(value.id, 'ASSISTANT_RUNTIME_REQUEST_USER_INPUT_INVALID')
    if (ids.has(id)) throw new Error('ASSISTANT_RUNTIME_REQUEST_USER_INPUT_INVALID')
    ids.add(id)
    const options = value.options === null
      ? null
      : Array.isArray(value.options)
        ? value.options.map((option) => {
            if (!isRecord(option)) throw new Error('ASSISTANT_RUNTIME_REQUEST_USER_INPUT_INVALID')
            return {
              label: requireString(option.label, 'ASSISTANT_RUNTIME_REQUEST_USER_INPUT_INVALID'),
              description: typeof option.description === 'string' ? option.description : '',
            }
          })
        : (() => { throw new Error('ASSISTANT_RUNTIME_REQUEST_USER_INPUT_INVALID') })()
    return {
      id,
      header: requireString(value.header, 'ASSISTANT_RUNTIME_REQUEST_USER_INPUT_INVALID'),
      question: requireString(value.question, 'ASSISTANT_RUNTIME_REQUEST_USER_INPUT_INVALID'),
      isOther: value.isOther === true,
      isSecret: value.isSecret === true,
      options,
    }
  })
}

export type AssistantRuntimeMcpElicitation = {
  readonly mode: 'form' | 'url'
  readonly message: string
  readonly requestedSchema: Record<string, unknown> | null
  readonly url: string | null
}

export function readAssistantRuntimeMcpElicitation(
  interaction: AssistantRuntimePendingInteractionView,
): AssistantRuntimeMcpElicitation {
  if (interaction.method !== 'mcpServer/elicitation/request' || !isRecord(interaction.params)) {
    throw new Error('ASSISTANT_RUNTIME_MCP_ELICITATION_INVALID')
  }
  const mode = interaction.params.mode
  if (mode === 'form') {
    if (!isRecord(interaction.params.requestedSchema)) {
      throw new Error('ASSISTANT_RUNTIME_MCP_ELICITATION_INVALID')
    }
    return {
      mode,
      message: requireString(interaction.params.message, 'ASSISTANT_RUNTIME_MCP_ELICITATION_INVALID'),
      requestedSchema: interaction.params.requestedSchema,
      url: null,
    }
  }
  if (mode === 'url') {
    let url: URL
    try {
      url = new URL(requireString(
        interaction.params.url,
        'ASSISTANT_RUNTIME_MCP_ELICITATION_INVALID',
      ))
    } catch {
      throw new Error('ASSISTANT_RUNTIME_MCP_ELICITATION_INVALID')
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('ASSISTANT_RUNTIME_MCP_ELICITATION_INVALID')
    }
    return {
      mode,
      message: requireString(interaction.params.message, 'ASSISTANT_RUNTIME_MCP_ELICITATION_INVALID'),
      requestedSchema: null,
      url: url.toString(),
    }
  }
  // openai/form is intentionally unsupported until its schema has a product
  // renderer. Guessing an arbitrary provider form would corrupt the response.
  throw new Error('ASSISTANT_RUNTIME_MCP_ELICITATION_MODE_UNSUPPORTED')
}

function validateRequestUserInputResult(
  interaction: AssistantRuntimePendingInteractionView,
  result: unknown,
): RuntimeJsonValue {
  const questions = readAssistantRuntimeUserInputQuestions(interaction)
  if (!isRecord(result)) throw new Error('ASSISTANT_RUNTIME_REQUEST_USER_INPUT_RESPONSE_INVALID')
  assertExactKeys(result, ['answers'], 'ASSISTANT_RUNTIME_REQUEST_USER_INPUT_RESPONSE_INVALID')
  if (!isRecord(result.answers)) throw new Error('ASSISTANT_RUNTIME_REQUEST_USER_INPUT_RESPONSE_INVALID')
  const answers = result.answers
  if (Object.keys(answers).some((id) => !questions.some((question) => question.id === id))) {
    throw new Error('ASSISTANT_RUNTIME_REQUEST_USER_INPUT_RESPONSE_INVALID')
  }
  const normalized: Record<string, RuntimeJsonValue> = {}
  for (const question of questions) {
    const answer = answers[question.id]
    if (!isRecord(answer)) throw new Error('ASSISTANT_RUNTIME_REQUEST_USER_INPUT_RESPONSE_INVALID')
    assertExactKeys(answer, ['answers'], 'ASSISTANT_RUNTIME_REQUEST_USER_INPUT_RESPONSE_INVALID')
    if (!Array.isArray(answer.answers) || answer.answers.length < 1 || answer.answers.length > 8) {
      throw new Error('ASSISTANT_RUNTIME_REQUEST_USER_INPUT_RESPONSE_INVALID')
    }
    const values = answer.answers.map((value) => requireString(
      value,
      'ASSISTANT_RUNTIME_REQUEST_USER_INPUT_RESPONSE_INVALID',
    ))
    const offered = new Set(question.options?.map((option) => option.label) ?? [])
    if (!question.isOther && question.options && values.some((value) => !offered.has(value))) {
      throw new Error('ASSISTANT_RUNTIME_REQUEST_USER_INPUT_RESPONSE_INVALID')
    }
    normalized[question.id] = { answers: values }
  }
  return { answers: normalized }
}

function validatePrimitive(value: unknown, schema: Record<string, unknown>): RuntimeJsonValue {
  const type = schema.type
  if (type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error('ASSISTANT_RUNTIME_MCP_ELICITATION_RESPONSE_INVALID')
    return value
  }
  if (type === 'number' || type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (type === 'integer' && !Number.isInteger(value))) {
      throw new Error('ASSISTANT_RUNTIME_MCP_ELICITATION_RESPONSE_INVALID')
    }
    return value
  }
  if (type === 'string') {
    const text = requireString(value, 'ASSISTANT_RUNTIME_MCP_ELICITATION_RESPONSE_INVALID')
    const offered = Array.isArray(schema.enum)
      ? schema.enum.filter((entry): entry is string => typeof entry === 'string')
      : Array.isArray(schema.oneOf)
        ? schema.oneOf.flatMap((entry) => isRecord(entry) && typeof entry.const === 'string' ? [entry.const] : [])
        : null
    if (offered && !offered.includes(text)) throw new Error('ASSISTANT_RUNTIME_MCP_ELICITATION_RESPONSE_INVALID')
    return text
  }
  const itemSchema = schema.items
  if (type === 'array' && isRecord(itemSchema) && Array.isArray(value)) {
    return value.map((entry) => validatePrimitive(entry, { ...itemSchema, type: 'string' }))
  }
  throw new Error('ASSISTANT_RUNTIME_MCP_ELICITATION_SCHEMA_UNSUPPORTED')
}

function validateMcpElicitationResult(
  interaction: AssistantRuntimePendingInteractionView,
  result: unknown,
): RuntimeJsonValue {
  const elicitation = readAssistantRuntimeMcpElicitation(interaction)
  if (!isRecord(result)) throw new Error('ASSISTANT_RUNTIME_MCP_ELICITATION_RESPONSE_INVALID')
  assertExactKeys(result, ['action', 'content', '_meta'], 'ASSISTANT_RUNTIME_MCP_ELICITATION_RESPONSE_INVALID')
  if (result.action !== 'accept' && result.action !== 'decline' && result.action !== 'cancel') {
    throw new Error('ASSISTANT_RUNTIME_MCP_ELICITATION_RESPONSE_INVALID')
  }
  if (result._meta !== null) throw new Error('ASSISTANT_RUNTIME_MCP_ELICITATION_RESPONSE_INVALID')
  if (result.action !== 'accept') {
    if (result.content !== null) throw new Error('ASSISTANT_RUNTIME_MCP_ELICITATION_RESPONSE_INVALID')
    return { action: result.action, content: null, _meta: null }
  }
  if (elicitation.mode === 'url') {
    if (result.content !== null) throw new Error('ASSISTANT_RUNTIME_MCP_ELICITATION_RESPONSE_INVALID')
    return { action: 'accept', content: null, _meta: null }
  }
  const schema = elicitation.requestedSchema
  if (!schema || schema.type !== 'object' || !isRecord(schema.properties) || !isRecord(result.content)) {
    throw new Error('ASSISTANT_RUNTIME_MCP_ELICITATION_RESPONSE_INVALID')
  }
  const properties = schema.properties
  const required = Array.isArray(schema.required)
    ? schema.required.map((key) => requireString(key, 'ASSISTANT_RUNTIME_MCP_ELICITATION_SCHEMA_INVALID'))
    : []
  if (Object.keys(result.content).some((key) => !Object.hasOwn(properties, key))) {
    throw new Error('ASSISTANT_RUNTIME_MCP_ELICITATION_RESPONSE_INVALID')
  }
  const content: Record<string, RuntimeJsonValue> = {}
  for (const [key, property] of Object.entries(properties)) {
    if (!isRecord(property)) throw new Error('ASSISTANT_RUNTIME_MCP_ELICITATION_SCHEMA_INVALID')
    const value = result.content[key]
    if (value === undefined) {
      if (required.includes(key)) throw new Error('ASSISTANT_RUNTIME_MCP_ELICITATION_RESPONSE_INVALID')
      continue
    }
    content[key] = validatePrimitive(value, property)
  }
  return { action: 'accept', content, _meta: null }
}

export function buildAssistantRuntimeServerResponse(input: {
  readonly interaction: AssistantRuntimePendingInteractionView
  readonly result: unknown
}): RuntimeServerRequestResponse {
  const interaction = input.interaction
  let result: RuntimeJsonValue
  if (interaction.method === 'item/commandExecution/requestApproval'
    || interaction.method === 'item/fileChange/requestApproval') {
    if (!isRecord(input.result)) throw new Error('ASSISTANT_RUNTIME_APPROVAL_RESPONSE_INVALID')
    assertExactKeys(input.result, ['decision'], 'ASSISTANT_RUNTIME_APPROVAL_RESPONSE_INVALID')
    if (input.result.decision !== 'accept' && input.result.decision !== 'decline') {
      throw new Error('ASSISTANT_RUNTIME_APPROVAL_RESPONSE_INVALID')
    }
    result = { decision: input.result.decision }
  } else if (interaction.method === 'item/tool/requestUserInput') {
    result = validateRequestUserInputResult(interaction, input.result)
  } else if (interaction.method === 'mcpServer/elicitation/request') {
    result = validateMcpElicitationResult(interaction, input.result)
  } else {
    throw new Error(`ASSISTANT_RUNTIME_REQUEST_METHOD_UNSUPPORTED:${interaction.method}`)
  }
  return { id: interaction.requestId, result }
}

/** Client boundary parser. The server owns detailed lifecycle validation. */
export async function parseAssistantRuntimeSessionView(
  value: unknown,
): Promise<AssistantRuntimeSessionView> {
  if (!isRecord(value) || value.protocol !== 'assistant_runtime_session_view_v1') {
    throw new Error('ASSISTANT_RUNTIME_SESSION_VIEW_PROTOCOL_INVALID')
  }
  if (!isRecord(value.scope) || value.scope.assistantId !== 'workspace-command') {
    throw new Error('ASSISTANT_RUNTIME_SESSION_VIEW_SCOPE_INVALID')
  }
  if (
    !Array.isArray(value.queuedTurns)
    || !Array.isArray(value.recentTurns)
    || !Array.isArray(value.followUpBatches)
  ) {
    throw new Error('ASSISTANT_RUNTIME_SESSION_VIEW_COLLECTION_INVALID')
  }
  if (value.thread !== null) {
    if (!isRecord(value.thread) || !Array.isArray(value.thread.messages)) {
      throw new Error('ASSISTANT_RUNTIME_SESSION_VIEW_THREAD_INVALID')
    }
    if (value.thread.messages.length > 0) {
      const parsed = await safeValidateUIMessages({ messages: value.thread.messages })
      if (!parsed.success) throw new Error('ASSISTANT_RUNTIME_SESSION_VIEW_MESSAGES_INVALID')
      value.thread.messages = parsed.data
    }
  }
  if (value.pendingInteraction !== null) {
    if (
      !isRecord(value.pendingInteraction)
      || value.pendingInteraction.kind !== 'runtime_request'
      || (typeof value.pendingInteraction.requestId !== 'string'
        && typeof value.pendingInteraction.requestId !== 'number')
      || typeof value.pendingInteraction.method !== 'string'
      || !isRecord(value.pendingInteraction.params)
    ) {
      throw new Error('ASSISTANT_RUNTIME_SESSION_VIEW_INTERACTION_INVALID')
    }
    const method = value.pendingInteraction.method
    if (!isAssistantRuntimeSupportedRequestMethod(method)) {
      throw new Error(`ASSISTANT_RUNTIME_REQUEST_METHOD_UNSUPPORTED:${method}`)
    }
  }
  return value as unknown as AssistantRuntimeSessionView
}

export type AgentSessionView = AssistantRuntimeSessionView
export type AgentSessionPendingInteractionView = AssistantRuntimePendingInteractionView
export const parseAgentSessionView = parseAssistantRuntimeSessionView
