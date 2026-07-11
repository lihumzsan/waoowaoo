export interface GoldenChatTool {
  readonly type: 'function'
  readonly function: {
    readonly name: string
    readonly description?: string
    readonly parameters?: unknown
  }
}

export interface GoldenChatMessage {
  readonly role: string
  readonly content?: unknown
  readonly tool_calls?: unknown
  readonly tool_call_id?: string
}

export interface GoldenChatCompletionRequest {
  readonly model: string
  readonly messages: readonly GoldenChatMessage[]
  readonly tools?: readonly GoldenChatTool[]
  readonly stream?: boolean
  readonly responseFormat?: unknown
}

export type GoldenModelDecision =
  | {
    readonly kind: 'text'
    readonly text: string
  }
  | {
    readonly kind: 'tool_call'
    readonly toolCallId: string
    readonly toolName: string
    readonly argumentsJson: string
  }
  | {
    readonly kind: 'tool_calls'
    readonly calls: readonly {
      readonly toolCallId: string
      readonly toolName: string
      readonly argumentsJson: string
    }[]
  }
  | {
    readonly kind: 'disconnect'
  }

export function parseGoldenChatCompletionRequest(value: unknown): GoldenChatCompletionRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('GOLDEN_MODEL_REQUEST_OBJECT_REQUIRED')
  }
  const record = value as Record<string, unknown>
  if (typeof record.model !== 'string' || !record.model.trim()) {
    throw new Error('GOLDEN_MODEL_REQUEST_MODEL_REQUIRED')
  }
  if (!Array.isArray(record.messages)) {
    throw new Error('GOLDEN_MODEL_REQUEST_MESSAGES_REQUIRED')
  }
  const tools = Array.isArray(record.tools)
    ? record.tools.flatMap((tool) => {
      if (!tool || typeof tool !== 'object' || Array.isArray(tool)) return []
      const toolRecord = tool as Record<string, unknown>
      const functionRecord = toolRecord.function
      if (toolRecord.type !== 'function' || !functionRecord || typeof functionRecord !== 'object' || Array.isArray(functionRecord)) {
        return []
      }
      const name = (functionRecord as Record<string, unknown>).name
      if (typeof name !== 'string' || !name.trim()) return []
      return [{
        type: 'function' as const,
        function: {
          ...(functionRecord as Record<string, unknown>),
          name,
        },
      }]
    })
    : undefined
  return {
    model: record.model,
    messages: record.messages as GoldenChatMessage[],
    ...(tools ? { tools } : {}),
    ...(typeof record.stream === 'boolean' ? { stream: record.stream } : {}),
    ...(record.response_format !== undefined ? { responseFormat: record.response_format } : {}),
  }
}

export function readGoldenScenarioId(authorization: string | undefined): string {
  const token = authorization?.replace(/^Bearer\s+/i, '').trim() ?? ''
  const prefix = 'golden-scenario:'
  if (!token.startsWith(prefix) || token.length === prefix.length) {
    throw new Error('GOLDEN_MODEL_SCENARIO_API_KEY_REQUIRED')
  }
  return token.slice(prefix.length)
}
