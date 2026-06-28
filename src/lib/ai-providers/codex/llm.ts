import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3Message,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3ToolResultOutput,
  LanguageModelV3Usage,
  SharedV3Warning,
} from '@ai-sdk/provider'
import { buildOpenAIChatCompletion } from '@/lib/ai-providers/shared/openai-chat-completion'
import { buildAiProviderLlmResult } from '@/lib/ai-providers/shared/llm-result'
import {
  emitStreamChunk,
  emitStreamStage,
  resolveStreamStepMeta,
} from '@/lib/ai-providers/shared/llm-support'
import type {
  AiProviderLanguageModelContext,
  AiProviderLlmResult,
  AiProviderLlmStreamContext,
} from '@/lib/ai-providers/runtime-types'
import type { AiLlmProviderConfig } from '@/lib/ai-registry/types'
import { CODEX_PROVIDER_KEY } from './constants'
import { runCodexTextCompletion, type CodexChatMessage } from './client'
import {
  buildCodexMessagesWithToolProtocol,
  CODEX_TOOL_CALL_FINISH_REASON,
  parseCodexToolProtocolOutput,
  shouldUseCodexToolProtocol,
} from './tool-call-protocol'

type NonSystemPromptMessage = Extract<LanguageModelV3Message, { role: 'user' | 'assistant' | 'tool' }>
type NonSystemPromptPart = NonSystemPromptMessage['content'][number]

const CODEX_FINISH_REASON: LanguageModelV3FinishReason = { unified: 'stop', raw: 'stop' }

function emptyLanguageModelUsage(): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: undefined,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: undefined,
      text: undefined,
      reasoning: undefined,
    },
  }
}

function warningsForUnsupportedOptions(
  options: LanguageModelV3CallOptions,
  toolProtocolEnabled: boolean,
): SharedV3Warning[] {
  if (toolProtocolEnabled) return []

  const warnings: SharedV3Warning[] = []
  if (options.toolChoice && options.toolChoice.type !== 'none') {
    warnings.push({
      type: 'unsupported',
      feature: 'toolChoice',
      details: 'Codex local language model requires declared tools before tool choice can be applied.',
    })
  }
  return warnings
}

function dataContentToText(value: string | Uint8Array | URL): string {
  if (typeof value === 'string') {
    return value.length > 240 ? `${value.slice(0, 240)}...` : value
  }
  if (value instanceof URL) return value.toString()
  return `[binary:${value.byteLength} bytes]`
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function toolResultOutputToText(output: LanguageModelV3ToolResultOutput): string {
  switch (output.type) {
    case 'text':
    case 'error-text':
      return output.value
    case 'json':
    case 'error-json':
      return safeJson(output.value)
    case 'execution-denied':
      return `execution denied${output.reason ? `: ${output.reason}` : ''}`
    case 'content':
      return output.value.map((item) => {
        switch (item.type) {
          case 'text':
            return item.text
          case 'file-data':
            return `[file-data:${item.mediaType}${item.filename ? `:${item.filename}` : ''}]`
          case 'file-url':
            return `[file-url:${item.url}]`
          case 'file-id':
            return `[file-id:${safeJson(item.fileId)}]`
          case 'image-data':
            return `[image-data:${item.mediaType}]`
          case 'image-url':
            return `[image-url:${item.url}]`
          default:
            return `[content:${safeJson(item)}]`
        }
      }).join('\n')
    default:
      return safeJson(output)
  }
}

function promptPartToText(part: NonSystemPromptPart): string {
  switch (part.type) {
    case 'text':
    case 'reasoning':
      return part.text
    case 'file':
      return `[file:${part.mediaType}${part.filename ? `:${part.filename}` : ''} ${dataContentToText(part.data)}]`
    case 'tool-call':
      return `[tool-call:${part.toolName}:${part.toolCallId} ${safeJson(part.input)}]`
    case 'tool-result':
      return `[tool-result:${part.toolName}:${part.toolCallId} ${toolResultOutputToText(part.output)}]`
    case 'tool-approval-response':
      return `[tool-approval-response:${part.approvalId} approved=${part.approved}${part.reason ? ` reason=${part.reason}` : ''}]`
    default:
      return safeJson(part)
  }
}

function promptMessageToCodexMessage(message: LanguageModelV3Message): CodexChatMessage {
  if (message.role === 'system') {
    return { role: 'system', content: message.content }
  }

  const content = message.content
    .map((part) => promptPartToText(part))
    .filter((text) => text.trim().length > 0)
    .join('\n')

  if (message.role === 'assistant') {
    return { role: 'assistant', content }
  }

  return { role: 'user', content }
}

function promptToCodexMessages(prompt: LanguageModelV3Prompt): CodexChatMessage[] {
  return prompt.map(promptMessageToCodexMessage)
}

async function runCodexLanguageModelText(input: {
  providerConfig: AiLlmProviderConfig
  modelId: string
  messages: CodexChatMessage[]
}) {
  return await runCodexTextCompletion({
    codexPath: input.providerConfig.baseUrl,
    model: input.modelId,
    messages: input.messages,
  })
}

export async function runCodexLlmCompletion(input: {
  providerConfig: AiLlmProviderConfig
  modelId: string
  messages: CodexChatMessage[]
}): Promise<AiProviderLlmResult> {
  const result = await runCodexLanguageModelText(input)
  const completion = buildOpenAIChatCompletion(input.modelId, result.text)
  return buildAiProviderLlmResult({
    completion,
    logProvider: CODEX_PROVIDER_KEY,
    text: result.text,
    reasoning: '',
    successDetails: { engine: 'codex_cli' },
  })
}

export async function runCodexLlmStream(input: AiProviderLlmStreamContext): Promise<AiProviderLlmResult> {
  const stepMeta = resolveStreamStepMeta(input.options)
  emitStreamStage(input.callbacks, stepMeta, 'streaming', CODEX_PROVIDER_KEY)
  const result = await runCodexLanguageModelText({
    providerConfig: input.providerConfig,
    modelId: input.selection.modelId,
    messages: input.messages,
  })
  if (result.text) {
    emitStreamChunk(input.callbacks, stepMeta, {
      kind: 'text',
      delta: result.text,
      seq: 1,
      lane: 'main',
    })
  }
  emitStreamStage(input.callbacks, stepMeta, 'completed', CODEX_PROVIDER_KEY)
  input.callbacks?.onComplete?.(result.text, stepMeta)

  const completion = buildOpenAIChatCompletion(input.selection.modelId, result.text)
  return buildAiProviderLlmResult({
    completion,
    logProvider: CODEX_PROVIDER_KEY,
    text: result.text,
    reasoning: '',
    successDetails: { engine: 'codex_cli_non_stream' },
  })
}

export function createCodexLanguageModel(input: AiProviderLanguageModelContext): LanguageModelV3 {
  return {
    specificationVersion: 'v3',
    provider: CODEX_PROVIDER_KEY,
    modelId: input.selection.modelId,
    supportedUrls: {},
    async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
      const toolProtocolEnabled = shouldUseCodexToolProtocol(options)
      const usage = emptyLanguageModelUsage()
      const warnings = warningsForUnsupportedOptions(options, toolProtocolEnabled)
      const result = await runCodexLanguageModelText({
        providerConfig: input.providerConfig,
        modelId: input.selection.modelId,
        messages: buildCodexMessagesWithToolProtocol(promptToCodexMessages(options.prompt), options),
      })
      if (toolProtocolEnabled) {
        const parsed = parseCodexToolProtocolOutput(result.text, options)
        if (parsed.kind === 'tool-call') {
          return {
            content: [parsed.toolCall],
            finishReason: CODEX_TOOL_CALL_FINISH_REASON,
            usage,
            warnings,
          }
        }
        return {
          content: [{ type: 'text', text: parsed.text }],
          finishReason: CODEX_FINISH_REASON,
          usage,
          warnings,
        }
      }
      return {
        content: [{ type: 'text', text: result.text }],
        finishReason: CODEX_FINISH_REASON,
        usage,
        warnings,
      }
    },
    async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
      const toolProtocolEnabled = shouldUseCodexToolProtocol(options)
      const result = await runCodexLanguageModelText({
        providerConfig: input.providerConfig,
        modelId: input.selection.modelId,
        messages: buildCodexMessagesWithToolProtocol(promptToCodexMessages(options.prompt), options),
      })
      const responseId = `codex-${Date.now()}`
      const usage = emptyLanguageModelUsage()
      const warnings = warningsForUnsupportedOptions(options, toolProtocolEnabled)
      const protocolOutput = toolProtocolEnabled
        ? parseCodexToolProtocolOutput(result.text, options)
        : null
      return {
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings })
            controller.enqueue({ type: 'response-metadata', id: responseId, modelId: input.selection.modelId, timestamp: new Date() })
            if (protocolOutput?.kind === 'tool-call') {
              const { toolCall } = protocolOutput
              controller.enqueue({
                type: 'tool-input-start',
                id: toolCall.toolCallId,
                toolName: toolCall.toolName,
              })
              controller.enqueue({
                type: 'tool-input-delta',
                id: toolCall.toolCallId,
                delta: toolCall.input,
              })
              controller.enqueue({ type: 'tool-input-end', id: toolCall.toolCallId })
              controller.enqueue(toolCall)
              controller.enqueue({ type: 'finish', usage, finishReason: CODEX_TOOL_CALL_FINISH_REASON })
            } else {
              const text = protocolOutput?.kind === 'text' ? protocolOutput.text : result.text
              controller.enqueue({ type: 'text-start', id: responseId })
              if (text) {
                controller.enqueue({ type: 'text-delta', id: responseId, delta: text })
              }
              controller.enqueue({ type: 'text-end', id: responseId })
              controller.enqueue({ type: 'finish', usage, finishReason: CODEX_FINISH_REASON })
            }
            controller.close()
          },
        }),
      }
    },
  }
}
