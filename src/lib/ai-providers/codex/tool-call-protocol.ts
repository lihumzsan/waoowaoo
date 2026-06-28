import type {
  LanguageModelV3CallOptions,
  LanguageModelV3FinishReason,
  LanguageModelV3FunctionTool,
  LanguageModelV3ProviderTool,
  LanguageModelV3ToolCall,
  LanguageModelV3ToolChoice,
} from '@ai-sdk/provider'
import type { CodexChatMessage } from './client'

type CodexToolProtocolOutput =
  | { kind: 'text'; text: string }
  | { kind: 'tool-call'; toolCall: LanguageModelV3ToolCall }

type CodexToolCallPayload = {
  type: 'tool_call'
  toolName: string
  input: Record<string, unknown>
}

type CodexFinalPayload = {
  type: 'final'
  text: string
}

type CodexToolPayload = CodexToolCallPayload | CodexFinalPayload

export const CODEX_TOOL_CALL_FINISH_REASON: LanguageModelV3FinishReason = {
  unified: 'tool-calls',
  raw: 'tool_calls',
}

export function shouldUseCodexToolProtocol(options: LanguageModelV3CallOptions): boolean {
  return Boolean(options.tools?.length && options.toolChoice?.type !== 'none')
}

export function buildCodexMessagesWithToolProtocol(
  messages: CodexChatMessage[],
  options: LanguageModelV3CallOptions,
): CodexChatMessage[] {
  if (!shouldUseCodexToolProtocol(options)) return messages

  const tools = collectFunctionTools(options.tools)
  const toolChoice = options.toolChoice ?? { type: 'auto' }
  validateToolChoice(toolChoice, tools)

  return [
    {
      role: 'system',
      content: buildToolProtocolPrompt(tools, toolChoice),
    },
    ...messages,
  ]
}

export function parseCodexToolProtocolOutput(
  text: string,
  options: LanguageModelV3CallOptions,
): CodexToolProtocolOutput {
  const tools = collectFunctionTools(options.tools)
  const toolChoice = options.toolChoice ?? { type: 'auto' }
  validateToolChoice(toolChoice, tools)

  const payload = parsePayload(text)
  if (payload.type === 'final') {
    if (toolChoice.type === 'required') {
      throw new Error('CODEX_TOOL_CALL_REQUIRED')
    }
    if (toolChoice.type === 'tool') {
      throw new Error(`CODEX_TOOL_CALL_REQUIRED:${toolChoice.toolName}`)
    }
    return { kind: 'text', text: payload.text }
  }

  const tool = tools.find((candidate) => candidate.name === payload.toolName)
  if (!tool) {
    throw new Error(`CODEX_TOOL_CALL_UNKNOWN_TOOL:${payload.toolName}`)
  }
  if (toolChoice.type === 'tool' && payload.toolName !== toolChoice.toolName) {
    throw new Error(`CODEX_TOOL_CALL_WRONG_TOOL:${payload.toolName}:${toolChoice.toolName}`)
  }

  return {
    kind: 'tool-call',
    toolCall: {
      type: 'tool-call',
      toolCallId: createToolCallId(tool.name),
      toolName: tool.name,
      input: JSON.stringify(payload.input),
    },
  }
}

function collectFunctionTools(
  tools: LanguageModelV3CallOptions['tools'],
): LanguageModelV3FunctionTool[] {
  if (!tools?.length) return []

  return tools.map((tool) => {
    if (isFunctionTool(tool)) return tool
    throw new Error(`CODEX_TOOL_PROTOCOL_UNSUPPORTED_TOOL_TYPE:${tool.name}`)
  })
}

function isFunctionTool(
  tool: LanguageModelV3FunctionTool | LanguageModelV3ProviderTool,
): tool is LanguageModelV3FunctionTool {
  return tool.type === 'function'
}

function validateToolChoice(
  toolChoice: LanguageModelV3ToolChoice,
  tools: LanguageModelV3FunctionTool[],
): void {
  if (toolChoice.type !== 'tool') return
  if (tools.some((tool) => tool.name === toolChoice.toolName)) return
  throw new Error(`CODEX_TOOL_CHOICE_UNKNOWN_TOOL:${toolChoice.toolName}`)
}

function buildToolProtocolPrompt(
  tools: LanguageModelV3FunctionTool[],
  toolChoice: LanguageModelV3ToolChoice,
): string {
  return [
    'Codex tool-call protocol:',
    'You are connected to a host runtime that executes the tools listed below.',
    'When a tool is needed, reply with exactly one JSON object and no markdown:',
    '{"type":"tool_call","toolName":"<tool_name>","input":{}}',
    'When no tool is needed, reply with exactly one JSON object and no markdown:',
    '{"type":"final","text":"<final answer>"}',
    `Tool choice: ${describeToolChoice(toolChoice)}.`,
    'Available tools:',
    JSON.stringify(tools.map(serializeToolForPrompt), null, 2),
  ].join('\n')
}

function describeToolChoice(toolChoice: LanguageModelV3ToolChoice): string {
  switch (toolChoice.type) {
    case 'auto':
      return 'auto'
    case 'none':
      return 'none'
    case 'required':
      return 'one available tool must be called'
    case 'tool':
      return `the tool named ${toolChoice.toolName} must be called`
  }
}

function serializeToolForPrompt(tool: LanguageModelV3FunctionTool): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    inputExamples: tool.inputExamples,
    strict: tool.strict,
  }
}

function parsePayload(text: string): CodexToolPayload {
  let value: unknown
  try {
    value = JSON.parse(text.trim())
  } catch {
    throw new Error('CODEX_TOOL_PROTOCOL_INVALID_JSON')
  }

  if (!isRecord(value)) {
    throw new Error('CODEX_TOOL_PROTOCOL_INVALID_PAYLOAD')
  }
  if (value.type === 'final') {
    if (typeof value.text !== 'string') {
      throw new Error('CODEX_TOOL_PROTOCOL_INVALID_FINAL_TEXT')
    }
    return { type: 'final', text: value.text }
  }
  if (value.type === 'tool_call') {
    if (typeof value.toolName !== 'string') {
      throw new Error('CODEX_TOOL_PROTOCOL_INVALID_TOOL_NAME')
    }
    if (!isRecord(value.input)) {
      throw new Error('CODEX_TOOL_PROTOCOL_INVALID_TOOL_INPUT')
    }
    return {
      type: 'tool_call',
      toolName: value.toolName,
      input: value.input,
    }
  }

  throw new Error(`CODEX_TOOL_PROTOCOL_UNSUPPORTED_TYPE:${String(value.type)}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function createToolCallId(toolName: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`
  return `codex_tool_${toolName}_${random.replaceAll('-', '')}`
}
